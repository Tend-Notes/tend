// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// An in-memory File System Access directory, for tests.
//
// The real API cannot be driven from a test: `showDirectoryPicker` needs a user
// gesture and a real folder. This fake implements the slice of the API that
// LocalFolderStore uses, with the same semantics that matter:
//
//   - `getFileHandle`/`getDirectoryHandle` throw NotFoundError without
//     `{create: true}`, which is how absence is detected
//   - a writable created with `createWritable()` buffers, and the file only
//     changes on `close()` — the swap-file behaviour writes depend on
//   - `lastModified` advances on write, which is what staleness detection reads
//   - permissions can be set to 'prompt' or 'denied' to exercise the re-grant
//     path
//
// It is deliberately not a general-purpose polyfill: no `resolve`, no cursors,
// nothing LocalFolderStore does not call.

/** A DOMException-shaped error, since that is what callers match on. */
function notFound(name: string): Error {
  const err = new Error(`${name} not found`)
  err.name = 'NotFoundError'
  return err
}

function notAllowed(): Error {
  const err = new Error('permission denied')
  err.name = 'NotAllowedError'
  return err
}

interface FakeFile {
  bytes: Uint8Array
  lastModified: number
}

/** Shared mutable state, so clocks and permissions are consistent across handles. */
class FakeRoot {
  /** Monotonic stand-in for wall-clock mtime: real timers are too coarse. */
  clock = 1_700_000_000_000
  permission: FileSystemPermissionState = 'granted'
  /** What requestPermission() will answer; 'granted' unless a test says otherwise. */
  grantOn: FileSystemPermissionState = 'granted'
  requests = 0

  tick(): number {
    this.clock += 1000
    return this.clock
  }
}

export class FakeFileHandle {
  readonly kind = 'file' as const

  constructor(
    readonly name: string,
    private readonly dir: FakeDirectoryHandle,
    private readonly root: FakeRoot
  ) {}

  private get file(): FakeFile {
    const f = this.dir.files.get(this.name)
    if (!f) throw notFound(this.name)
    return f
  }

  async getFile(): Promise<File> {
    const { bytes, lastModified } = this.file
    // A real File, so callers can use arrayBuffer()/text() as they would.
    return new File([bytes as BlobPart], this.name, { lastModified })
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    this.root.permission === 'granted' || (() => { throw notAllowed() })()

    const chunks: Uint8Array[] = []
    const dir = this.dir
    const name = this.name
    const root = this.root

    // Mirrors the real thing: writes buffer, and nothing lands until close().
    return {
      async write(data: unknown) {
        chunks.push(toBytes(data))
      },
      async close() {
        const total = chunks.reduce((n, c) => n + c.length, 0)
        const bytes = new Uint8Array(total)
        let at = 0
        for (const c of chunks) {
          bytes.set(c, at)
          at += c.length
        }
        dir.files.set(name, { bytes, lastModified: root.tick() })
      },
      async abort() {
        chunks.length = 0
      },
    } as unknown as FileSystemWritableFileStream
  }

  async queryPermission(): Promise<FileSystemPermissionState> {
    return this.root.permission
  }
}

function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (typeof data === 'string') return new TextEncoder().encode(data)
  throw new TypeError('unsupported write payload')
}

export class FakeDirectoryHandle {
  readonly kind = 'directory' as const
  readonly files = new Map<string, FakeFile>()
  readonly dirs = new Map<string, FakeDirectoryHandle>()

  constructor(
    readonly name: string,
    private readonly root: FakeRoot = new FakeRoot()
  ) {}

  /** Build a root handle, optionally seeded with `path -> contents`. */
  static create(seed: Record<string, string | Uint8Array> = {}): FakeDirectoryHandle {
    const root = new FakeDirectoryHandle('garden')
    for (const [path, contents] of Object.entries(seed)) {
      root.seedFile(path, contents)
    }
    return root
  }

  /** Write a file directly, creating parents. Test setup only. */
  seedFile(path: string, contents: string | Uint8Array): void {
    const parts = path.split('/').filter(Boolean)
    const name = parts.pop()
    if (!name) throw new Error(`bad seed path: ${path}`)

    let dir: FakeDirectoryHandle = this
    for (const part of parts) {
      let next = dir.dirs.get(part)
      if (!next) {
        next = new FakeDirectoryHandle(part, this.root)
        dir.dirs.set(part, next)
      }
      dir = next
    }
    dir.files.set(name, { bytes: toBytes(contents), lastModified: this.root.tick() })
  }

  /** Every file in the tree as `path -> text`. Test assertions only. */
  snapshot(prefix = ''): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [name, file] of this.files) {
      out[prefix + name] = new TextDecoder().decode(file.bytes)
    }
    for (const [name, dir] of this.dirs) {
      Object.assign(out, dir.snapshot(`${prefix}${name}/`))
    }
    return out
  }

  /** Raw bytes at a path, or undefined. Test assertions only. */
  bytesAt(path: string): Uint8Array | undefined {
    const parts = path.split('/').filter(Boolean)
    const name = parts.pop()
    let dir: FakeDirectoryHandle | undefined = this
    for (const part of parts) {
      dir = dir?.dirs.get(part)
    }
    return name ? dir?.files.get(name)?.bytes : undefined
  }

  // --- the API surface LocalFolderStore uses -------------------------------

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<FileSystemDirectoryHandle> {
    const existing = this.dirs.get(name)
    if (existing) return existing as unknown as FileSystemDirectoryHandle
    if (!options?.create) throw notFound(name)

    if (this.root.permission !== 'granted') throw notAllowed()
    const dir = new FakeDirectoryHandle(name, this.root)
    this.dirs.set(name, dir)
    return dir as unknown as FileSystemDirectoryHandle
  }

  async getFileHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<FileSystemFileHandle> {
    if (!this.files.has(name)) {
      if (!options?.create) throw notFound(name)
      if (this.root.permission !== 'granted') throw notAllowed()
      this.files.set(name, { bytes: new Uint8Array(), lastModified: this.root.tick() })
    }
    return new FakeFileHandle(name, this, this.root) as unknown as FileSystemFileHandle
  }

  async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    if (this.files.delete(name)) return
    const dir = this.dirs.get(name)
    if (!dir) throw notFound(name)
    if (!options?.recursive && (dir.files.size || dir.dirs.size)) {
      const err = new Error(`${name} is not empty`)
      err.name = 'InvalidModificationError'
      throw err
    }
    this.dirs.delete(name)
  }

  async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
    for (const name of this.files.keys()) {
      yield [name, new FakeFileHandle(name, this, this.root) as unknown as FileSystemHandle]
    }
    for (const [name, dir] of this.dirs) {
      yield [name, dir as unknown as FileSystemHandle]
    }
  }

  async queryPermission(): Promise<FileSystemPermissionState> {
    return this.root.permission
  }

  async requestPermission(): Promise<FileSystemPermissionState> {
    this.root.requests++
    this.root.permission = this.root.grantOn
    return this.root.permission
  }

  // --- test controls -------------------------------------------------------

  /** Simulate a browser restart: the handle survives, the grant does not. */
  setPermission(state: FileSystemPermissionState, grantOn: FileSystemPermissionState = 'granted') {
    this.root.permission = state
    this.root.grantOn = grantOn
  }

  /** How many times requestPermission() was called — a gesture is required. */
  get permissionRequests(): number {
    return this.root.requests
  }

  /** Simulate the folder being deleted or moved away. */
  vanish(): void {
    this.files.clear()
    this.dirs.clear()
    this.root.permission = 'denied'
  }

  asHandle(): FileSystemDirectoryHandle {
    return this as unknown as FileSystemDirectoryHandle
  }
}
