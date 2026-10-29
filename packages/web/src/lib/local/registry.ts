// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Where local gardens are recorded.
//
// Local gardens cannot live in the server's registry — the server has never
// seen the folder and must not learn anything about it — so the list lives in
// IndexedDB, per browser profile. That is also why a local garden simply does
// not appear when Tend is opened on another machine: there is nothing to
// recover, and nothing has gone wrong.
//
// Two things are stored, and only two:
//
//   - the handle for the gardens ROOT the user picked once
//   - one entry per garden: its id, display name, folder name, and whether it
//     is encrypted
//
// Nothing derived from note content is ever written here. No decrypted text, no
// search or link data, no passphrase. Directory handles are not secrets (they
// confer nothing without the browser's permission grant), which is why they are
// the one handle-shaped thing that may be persisted.

/** A garden whose files live in a folder on this machine. */
export interface LocalGarden {
  /** Stable id, also the subdirectory name under the gardens root. */
  id: string
  /** What the user calls it. */
  name: string
  /** Whether note files are age-encrypted. Fixed at creation. */
  encrypted: boolean
  /** ISO timestamp, for ordering the list. */
  createdAt: string
}

/**
 * Persistence for the registry. An interface because the logic above it is
 * worth testing in Node, where there is no IndexedDB.
 */
export interface RegistryStore {
  getRoot(): Promise<FileSystemDirectoryHandle | null>
  setRoot(handle: FileSystemDirectoryHandle): Promise<void>
  clearRoot(): Promise<void>
  listGardens(): Promise<LocalGarden[]>
  putGarden(garden: LocalGarden): Promise<void>
  removeGarden(id: string): Promise<void>
}

const DB_NAME = 'tend-local-gardens'
const DB_VERSION = 1
const HANDLES = 'handles'
const GARDENS = 'gardens'
const ROOT_KEY = 'root'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(new Error('could not open the local-garden registry'))
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      // Handles go in their own store: they are structured-cloneable objects,
      // not JSON, and they are the only thing here the browser treats specially.
      if (!db.objectStoreNames.contains(HANDLES)) db.createObjectStore(HANDLES)
      if (!db.objectStoreNames.contains(GARDENS)) db.createObjectStore(GARDENS, { keyPath: 'id' })
    }
  })
}

function run<T>(store: IDBObjectStore, request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('registry request failed'))
    void store
  })
}

/** The real store, backed by IndexedDB. */
export class IndexedDbRegistry implements RegistryStore {
  private async tx(name: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await open()
    return db.transaction(name, mode).objectStore(name)
  }

  async getRoot(): Promise<FileSystemDirectoryHandle | null> {
    const store = await this.tx(HANDLES, 'readonly')
    return (await run(store, store.get(ROOT_KEY))) ?? null
  }

  async setRoot(handle: FileSystemDirectoryHandle): Promise<void> {
    const store = await this.tx(HANDLES, 'readwrite')
    await run(store, store.put(handle, ROOT_KEY))
  }

  async clearRoot(): Promise<void> {
    const store = await this.tx(HANDLES, 'readwrite')
    await run(store, store.delete(ROOT_KEY))
  }

  async listGardens(): Promise<LocalGarden[]> {
    const store = await this.tx(GARDENS, 'readonly')
    const all = (await run(store, store.getAll())) as LocalGarden[]
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async putGarden(garden: LocalGarden): Promise<void> {
    const store = await this.tx(GARDENS, 'readwrite')
    await run(store, store.put(garden))
  }

  async removeGarden(id: string): Promise<void> {
    const store = await this.tx(GARDENS, 'readwrite')
    await run(store, store.delete(id))
  }
}

/** In-memory store, for tests and for a browser with IndexedDB unavailable. */
export class MemoryRegistry implements RegistryStore {
  private root: FileSystemDirectoryHandle | null = null
  private gardens = new Map<string, LocalGarden>()

  async getRoot() {
    return this.root
  }
  async setRoot(handle: FileSystemDirectoryHandle) {
    this.root = handle
  }
  async clearRoot() {
    this.root = null
  }
  async listGardens() {
    return [...this.gardens.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
  async putGarden(garden: LocalGarden) {
    this.gardens.set(garden.id, garden)
  }
  async removeGarden(id: string) {
    this.gardens.delete(id)
  }
}

/**
 * Turn a display name into a directory name.
 *
 * Deliberately stricter than the garden's own filename encoding: this is a
 * directory the user will see in their file manager, so it stays plain rather
 * than percent-encoded, and a name that reduces to nothing falls back to a
 * timestamp rather than failing.
 */
export function gardenIdFromName(name: string, taken: Iterable<string> = []): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || `garden-${Date.now()}`

  const used = new Set(taken)
  if (!used.has(base)) return base
  // Collisions are possible ("Work Notes" twice); suffix rather than refuse.
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!used.has(candidate)) return candidate
  }
}
