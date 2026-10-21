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
  constructor(private readonly root: FileSystemDirectoryHandle) {}

  /** The folder's own name, for display ("which folder is this garden?"). */
  get folderName(): string {
    return this.root.name
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

  /** Read a file, or null when it does not exist. */
  async read(path: string): Promise<ReadResult | null> {
    const handle = await this.fileHandle(path, false)
    if (!handle) return null
    const file = await handle.getFile()
    return {
      bytes: new Uint8Array(await file.arrayBuffer()),
      lastModified: file.lastModified,
    }
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

    if (expectedLastModified !== undefined) {
      const actual = await this.lastModified(path)
      // A file that has since been deleted is also a change, but recreating it
      // is what the user asked for, so only a *differing* mtime blocks.
      if (actual !== null && actual !== expectedLastModified) {
        throw new StaleWriteError(path, expectedLastModified, actual)
      }
    }

    const handle = await this.fileHandle(path, true)
    if (!handle) throw new FolderUnavailableError(`could not create ${path}`)

    const writable = await handle.createWritable()
    try {
      await writable.write(typeof data === 'string' ? new TextEncoder().encode(data) : data)
      await writable.close()
    } catch (e) {
      // Leave the previous contents in place rather than a half-written file.
      await writable.abort?.().catch(() => {})
      throw new FolderUnavailableError(`could not write ${path}`, e)
    }

    return (await this.lastModified(path)) ?? 0
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
