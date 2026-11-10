// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Path-addressed file access over a File System Access directory handle.
//
// The rest of the local-garden code thinks in garden-relative paths —
// "pages/Notes.md", "journals/2026-01-01.md.age", ".tend/identity.age" — and
// this is the only module that knows those are nested handles. Everything here
// is bytes and paths; nothing knows what a Page is.
//
// Three behaviours worth stating because they are not obvious from the API:
//
//   - Writes go through `createWritable()`, which writes to a swap file and
//     commits on `close()`. A crash mid-write leaves the previous file intact.
//   - Every read reports `lastModified`, and `write` can be given the value a
//     caller last saw. If the file has changed since, the write is refused:
//     that is how an edit by another program is detected (a single writer is
//     assumed, and no merge is attempted).
//   - A saved handle's permission does not survive a browser restart, so
//     `ensurePermission` has to be called from a user gesture.

/** A file's bytes plus the mtime a later write can check against. */
export interface ReadResult {
  bytes: Uint8Array
  lastModified: number
}

export interface WriteOptions {
  /**
   * The `lastModified` the caller last read. When given and the file has
   * changed since, the write throws `StaleWriteError` instead of clobbering.
   */
  expectedLastModified?: number
}

/** The folder changed underneath us; the caller decides what to do. */
export class StaleWriteError extends Error {
  constructor(
    readonly path: string,
    readonly expected: number,
    readonly actual: number
  ) {
    super(`${path} changed on disk since it was read`)
    this.name = 'StaleWriteError'
  }
}

/**
 * A read could not be completed because the file was changing underneath it.
 *
 * `getFile()` hands back a snapshot — path, size, mtime — and the bytes are
 * fetched only when something reads them. If the file changes in between, the
 * read fails rather than returning a torn mix of old and new content, which is
 * the behaviour we want: a torn markdown note is a mangled page, and a torn
 * `.age` file is an undecryptable blob. The documented remedy is to call
 * `getFile()` again, so the store retries once. A second failure means
 * something really is writing to the file, which is the same condition as
 * `StaleWriteError` and reaches the UI by the same path.
 */
export class StaleReadError extends Error {
  constructor(readonly path: string, readonly cause?: unknown) {
    super(`${path} is being written by something else`)
    this.name = 'StaleReadError'
  }
}

/** The handle is no longer usable: permission withdrawn, or folder gone. */
export class FolderUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'FolderUnavailableError'
  }
}

function isNotFound(e: unknown): boolean {
  return e instanceof Error && e.name === 'NotFoundError'
}

/** A read that lost a race with a writer, rather than a broken handle. */
function isUnreadable(e: unknown): boolean {
  return e instanceof Error && (e.name === 'NotReadableError' || e.name === 'NotReadableErr')
}

/** Split a garden-relative path, rejecting anything that could escape it. */
export function splitPath(path: string): { dirs: string[]; name: string } {
  const parts = path.split('/').filter((p) => p.length > 0)
  if (parts.length === 0) throw new Error(`empty path: ${path}`)
  if (parts.some((p) => p === '.' || p === '..')) {
    throw new Error(`path must not contain . or ..: ${path}`)
  }
  const name = parts.pop() as string
  return { dirs: parts, name }
}

export class LocalFolderStore {
  /**
   * Paths this store is part-way through writing.
   *
   * The folder watcher reads this to drop the `modified` records our own saves
   * cause; without it every save would trigger a reload of the note just
   * saved. `tend-storage`'s watcher keeps exactly the same set
   * (`crates/tend-storage/src/watcher.rs`), and for the same reason.
   */
  private readonly writing = new Set<string>()

  /** Writes held for another attempt after a transient failure. */
  private readonly queued = new Map<string, { data: Uint8Array; attempts: number }>()
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly root: FileSystemDirectoryHandle) {}

  /** The folder's own name, for display ("which folder is this garden?"). */
  get folderName(): string {
    return this.root.name
  }

  /**
   * The garden's directory handle.
   *
   * Exposed for the folder watcher, which `observe()`s the handle itself. The
   * rest of the app addresses files by path and has no business holding this.
   */
  get directory(): FileSystemDirectoryHandle {
    return this.root
  }

  /** Whether this store is mid-write on `path`. Read by the folder watcher. */
  isWriting(path: string): boolean {
    return this.writing.has(path)
  }

  /** How many writes are waiting to be retried. For the UI's save indicator. */
  get queuedWrites(): number {
    return this.queued.size
  }

  // --- permissions ---------------------------------------------------------

  /** Current grant, without prompting. */
  async permission(): Promise<FileSystemPermissionState> {
    if (!this.root.queryPermission) return 'granted' // not Chromium; caller has already warned
    try {
      return await this.root.queryPermission({ mode: 'readwrite' })
    } catch (e) {
      throw new FolderUnavailableError('could not check folder permission', e)
    }
  }

  /**
   * Ensure read-write access, prompting if needed.
   *
   * MUST be called from a user gesture — the browser rejects the prompt
   * otherwise, which is why the UI is a "Reconnect <folder>" button rather than
   * something that happens on load.
   */
  async ensurePermission(): Promise<boolean> {
    if ((await this.permission()) === 'granted') return true
    if (!this.root.requestPermission) return false
    try {
      return (await this.root.requestPermission({ mode: 'readwrite' })) === 'granted'
    } catch (e) {
      throw new FolderUnavailableError('could not request folder permission', e)
    }
  }

  /**
   * Whether the folder is still there and usable. A handle outlives the folder
   * it points at: it can be moved, renamed or deleted between sessions.
   */
  async isAvailable(): Promise<boolean> {
    try {
      if ((await this.permission()) !== 'granted') return false
      // Touching the directory is the only way to find out it is gone.
      await this.list('')
      return true
    } catch {
      return false
    }
  }

  // --- reading -------------------------------------------------------------

  /** Resolve a directory, optionally creating it. */
  private async dir(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> {
    let handle = this.root
    for (const part of parts) {
      try {
        handle = await handle.getDirectoryHandle(part, { create })
      } catch (e) {
        if (isNotFound(e)) return null
        throw new FolderUnavailableError(`could not open ${parts.join('/')}`, e)
      }
    }
    return handle
  }

  private async fileHandle(path: string, create: boolean): Promise<FileSystemFileHandle | null> {
    const { dirs, name } = splitPath(path)
    const dir = await this.dir(dirs, create)
    if (!dir) return null
    try {
      return await dir.getFileHandle(name, { create })
    } catch (e) {
      if (isNotFound(e)) return null
      throw new FolderUnavailableError(`could not open ${path}`, e)
    }
  }

  /**
   * Read a file, or null when it does not exist.
   *
   * Retried once on a failed read, which is the documented remedy for losing a
   * race with a writer. A second failure is a real condition, not a blip, and
   * is reported as `StaleReadError` rather than letting a DOM exception escape.
   */
  async read(path: string): Promise<ReadResult | null> {
    const handle = await this.fileHandle(path, false)
    if (!handle) return null

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const file = await handle.getFile()
        return {
          bytes: new Uint8Array(await file.arrayBuffer()),
          lastModified: file.lastModified,
        }
      } catch (e) {
        if (!isUnreadable(e)) {
          if (isNotFound(e)) return null
          throw new FolderUnavailableError(`could not read ${path}`, e)
        }
        if (attempt === 1) throw new StaleReadError(path, e)
      }
    }
    // Unreachable: the loop either returns or throws.
    throw new StaleReadError(path)
  }

  /** Read a file as UTF-8 text, or null. */
  async readText(path: string): Promise<{ text: string; lastModified: number } | null> {
    const result = await this.read(path)
    if (!result) return null
    return { text: new TextDecoder().decode(result.bytes), lastModified: result.lastModified }
  }

  async exists(path: string): Promise<boolean> {
    return (await this.fileHandle(path, false)) !== null
  }

  /** A file's mtime, or null when it does not exist. */
  async lastModified(path: string): Promise<number | null> {
    const handle = await this.fileHandle(path, false)
    if (!handle) return null
    return (await handle.getFile()).lastModified
  }

  // --- writing -------------------------------------------------------------

  /**
   * Write bytes, creating parent directories. Commits atomically on close.
   *
   * Returns the new `lastModified`, which the caller keeps for its next write.
   */
  async write(
    path: string,
    data: Uint8Array | string,
    options: WriteOptions = {}
  ): Promise<number> {
    const { expectedLastModified } = options
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data

    if (expectedLastModified !== undefined) {
      const actual = await this.lastModified(path)
      // A file that has since been deleted is also a change, but recreating it
      // is what the user asked for, so only a *differing* mtime blocks.
      if (actual !== null && actual !== expectedLastModified) {
        throw new StaleWriteError(path, expectedLastModified, actual)
      }
    }

    // In the set before the write and out of it after, so the watcher can tell
    // our own `modified` record from someone else's.
    this.writing.add(path)
    try {
      return await this.writeBytes(path, bytes)
    } catch (e) {
      // A transient failure must not lose the edit: hold the bytes and try
      // again. The caller carries on, and the editor with it.
      if (e instanceof FolderUnavailableError) {
        this.queueWrite(path, bytes)
        throw e
      }
      throw e
    } finally {
      this.writing.delete(path)
    }
  }

  /** The write itself, with no staleness check and no queueing. */
  private async writeBytes(path: string, bytes: Uint8Array): Promise<number> {
    const handle = await this.fileHandle(path, true)
    if (!handle) throw new FolderUnavailableError(`could not create ${path}`)

    let writable: FileSystemWritableFileStream
    try {
      writable = await handle.createWritable()
    } catch (e) {
      throw new FolderUnavailableError(`could not open ${path} for writing`, e)
    }

    try {
      await writable.write(bytes)
      await writable.close()
    } catch (e) {
      // Leave the previous contents in place rather than a half-written file.
      await writable.abort?.().catch(() => {})
      throw new FolderUnavailableError(`could not write ${path}`, e)
    }

    return (await this.lastModified(path)) ?? 0
  }

  // --- the retry queue -----------------------------------------------------
  //
  // A write can fail for reasons that have nothing to do with the edit:
  // permission dropped after a restart, an external drive briefly unmounted, a
  // sync client mid-operation. Those are measured in seconds, so the bytes are
  // held in memory and re-attempted. Anything that has to survive a page reload
  // is the draft store's job, not this one's.

  /** How long to wait before the Nth attempt, capped. */
  private static retryDelay(attempts: number): number {
    return Math.min(1000 * 2 ** attempts, 30_000)
  }

  private queueWrite(path: string, data: Uint8Array): void {
    const existing = this.queued.get(path)
    // A newer write supersedes an older queued one: the last edit is the one
    // the user means.
    this.queued.set(path, { data, attempts: existing?.attempts ?? 0 })
    this.scheduleRetry()
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.queued.size === 0) return
    const attempts = Math.min(...[...this.queued.values()].map((q) => q.attempts))
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.flushQueue()
    }, LocalFolderStore.retryDelay(attempts))
  }

  /**
   * Re-attempt every queued write. Returns how many landed.
   *
   * Public so the UI can offer "try again now" and so a test does not have to
   * wait on a timer.
   */
  async flushQueue(): Promise<number> {
    let written = 0
    for (const [path, entry] of [...this.queued]) {
      this.writing.add(path)
      try {
        await this.writeBytes(path, entry.data)
        this.queued.delete(path)
        written += 1
      } catch {
        // Still failing. Keep it, and back off further.
        this.queued.set(path, { ...entry, attempts: entry.attempts + 1 })
      } finally {
        this.writing.delete(path)
      }
    }
    this.scheduleRetry()
    return written
  }

  /** Stop retrying. Called when the garden closes; queued edits are dropped. */
  cancelQueuedWrites(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.queued.clear()
  }

  /** Delete a file. Missing is success: the caller wanted it gone. */
  async delete(path: string): Promise<void> {
    const { dirs, name } = splitPath(path)
    const dir = await this.dir(dirs, false)
    if (!dir) return
    try {
      await dir.removeEntry(name)
    } catch (e) {
      if (isNotFound(e)) return
      throw new FolderUnavailableError(`could not delete ${path}`, e)
    }
  }

  /** Create a directory (and its parents) if absent. */
  async ensureDir(path: string): Promise<void> {
    const parts = path.split('/').filter(Boolean)
    if (parts.length === 0) return
    await this.dir(parts, true)
  }

  // --- listing -------------------------------------------------------------

  /**
   * Entries directly inside `dirPath` ('' for the garden root). A missing
   * directory lists as empty — callers treat "no pages/ yet" as "no pages".
   */
  async list(dirPath: string): Promise<{ name: string; isDirectory: boolean }[]> {
    const dir = await this.dir(dirPath.split('/').filter(Boolean), false)
    if (!dir) return []

    const out: { name: string; isDirectory: boolean }[] = []
    try {
      for await (const [name, handle] of dir.entries()) {
        out.push({ name, isDirectory: handle.kind === 'directory' })
      }
    } catch (e) {
      throw new FolderUnavailableError(`could not list ${dirPath || '/'}`, e)
    }
    return out
  }

  /**
   * Every file at or below `dirPath`, as paths relative to it.
   *
   * Depth-first and unbounded, which is fine for a garden: content types nest
   * at most two levels (`meetings/2026-01-01/Standup.md`,
   * `books/MyNovel/Chapter One.md`).
   */
  async listFiles(dirPath: string): Promise<string[]> {
    const out: string[] = []
    const walk = async (prefix: string) => {
      for (const entry of await this.list(prefix)) {
        const child = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory) await walk(child)
        else out.push(child)
      }
    }
    await walk(dirPath.replace(/\/$/, ''))

    const base = dirPath ? `${dirPath.replace(/\/$/, '')}/` : ''
    return out.map((p) => (base && p.startsWith(base) ? p.slice(base.length) : p))
  }
}
