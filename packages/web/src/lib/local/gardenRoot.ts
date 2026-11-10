// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// The gardens root: one folder the user picks, inside which every local garden
// lives as a subdirectory.
//
// Why a single root rather than a handle per garden:
//
//   - Confinement. The web platform never tells a page where a folder is —
//     `handle.name` is a bare leaf name, there is no path and no parent
//     traversal — so "is this folder under ~ / under Documents?" is not a
//     question Tend can answer, let alone enforce. What it *can* enforce is
//     containment relative to a handle it already holds: every garden is
//     created with `root.getDirectoryHandle(id, {create: true})`, so a garden
//     can only ever be a child of the folder the user chose. `root.resolve()`
//     re-checks that for any handle handed back later.
//   - Permissions. One grant covers every garden, so reconnecting after a
//     browser restart is a single prompt rather than one per garden.
//
// The trade-off, which is real: you cannot point a garden at an arbitrary
// existing folder elsewhere on the disk. Gardens live where the root lives.

import { LocalFolderStore } from './LocalFolderStore'
import { gardenIdFromName, type LocalGarden, type RegistryStore } from './registry'
import { loadWasm } from '../wasm'

/** Nothing usable: no picker (not Chromium), or the user dismissed it. */
export class RootUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'RootUnavailableError'
  }
}

/** Whether this browser can do local gardens at all. */
export function isSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

/**
 * Ask the user for the gardens root. MUST be called from a user gesture.
 *
 * `startIn: 'documents'` only positions the dialog — the platform has no way to
 * constrain where the user goes from there, so this is a nudge, not a boundary.
 */
export async function pickGardensRoot(): Promise<FileSystemDirectoryHandle> {
  if (!isSupported()) {
    throw new RootUnavailableError(
      'This browser cannot open local folders. Local gardens need a Chromium browser such as Edge.'
    )
  }
  try {
    return await window.showDirectoryPicker!({
      id: 'tend-gardens',
      mode: 'readwrite',
      startIn: 'documents',
    })
  } catch (e) {
    // An AbortError is the user closing the dialog, which is not a failure.
    if (e instanceof Error && e.name === 'AbortError') {
      throw new RootUnavailableError('No folder chosen', e)
    }
    throw new RootUnavailableError('Could not open the folder picker', e)
  }
}

/**
 * Is `handle` inside `root`? The only containment question the platform can
 * answer, and the reason the root exists.
 */
export async function isInsideRoot(
  root: FileSystemDirectoryHandle,
  handle: FileSystemHandle
): Promise<boolean> {
  try {
    const path = await root.resolve(handle)
    return path !== null
  } catch {
    return false
  }
}

/** The permission state of the root, which covers every garden under it. */
export async function rootPermission(
  root: FileSystemDirectoryHandle
): Promise<FileSystemPermissionState> {
  return new LocalFolderStore(root).permission()
}

/**
 * Re-grant access to the root. MUST be called from a user gesture: this is the
 * "Reconnect <folder>" button, not something that can happen on load.
 */
export async function reconnectRoot(root: FileSystemDirectoryHandle): Promise<boolean> {
  return new LocalFolderStore(root).ensurePermission()
}

/** What the UI needs to know about the root before it can do anything. */
export type RootStatus =
  | { state: 'unsupported' }
  | { state: 'none' }
  | { state: 'needs-permission'; folderName: string }
  | { state: 'missing'; folderName: string }
  | { state: 'ready'; folderName: string; root: FileSystemDirectoryHandle }

/**
 * Where things stand on load, without prompting for anything.
 *
 * A saved handle outlives both the permission grant (dropped on browser
 * restart) and the folder itself (the user can move or delete it), so those are
 * separate states with separate remedies: reconnect, or pick again.
 */
export async function rootStatus(registry: RegistryStore): Promise<RootStatus> {
  if (!isSupported()) return { state: 'unsupported' }

  const root = await registry.getRoot()
  if (!root) return { state: 'none' }

  const store = new LocalFolderStore(root)
  if ((await store.permission()) !== 'granted') {
    return { state: 'needs-permission', folderName: root.name }
  }
  if (!(await store.isAvailable())) {
    return { state: 'missing', folderName: root.name }
  }
  return { state: 'ready', folderName: root.name, root }
}

/** Directories every garden has, server-written or not. */
const GARDEN_DIRS = ['pages', 'journals', '.tend']

/**
 * Create a garden as a subdirectory of the root, and register it.
 *
 * For an encrypted garden the bootstrap matches the server's order exactly —
 * `.tend/encryption.verify` first, then the wrapped identity — because the
 * server checks the verify file before it will mint an identity, and a garden
 * written the other way round would be one the server refuses to open.
 *
 * The passphrase is used here and then dropped; it is never stored. The
 * returned identity is the caller's to hold in memory for the session.
 */
export async function createLocalGarden(
  registry: RegistryStore,
  root: FileSystemDirectoryHandle,
  options: { name: string; passphrase?: string }
): Promise<{ garden: LocalGarden; store: LocalFolderStore; identity?: string }> {
  const name = options.name.trim()
  if (!name) throw new Error('A garden needs a name')

  const existing = await registry.listGardens()
  const id = gardenIdFromName(name, existing.map((g) => g.id))

  // Created under the root, so containment holds by construction.
  const dir = await root.getDirectoryHandle(id, { create: true })
  const store = new LocalFolderStore(dir)
  for (const d of GARDEN_DIRS) await store.ensureDir(d)

  let identity: string | undefined
  if (options.passphrase) {
    const wasm = await loadWasm()
    // Verify file first — the server's own order (routes/gardens.rs, then
    // encrypted_fs.rs::load_or_create_identity).
    await store.write(
      '.tend/encryption.verify',
      wasm.encrypt_scrypt('tend-encryption-verification', options.passphrase)
    )
    identity = wasm.generate_identity()
    await store.write('.tend/identity.age', wasm.wrap_identity(identity, options.passphrase))
  }

  const garden: LocalGarden = {
    id,
    name,
    encrypted: !!options.passphrase,
    createdAt: new Date().toISOString(),
  }
  await registry.putGarden(garden)

  return { garden, store, identity }
}

/** Open a registered garden's folder. Null when its directory has gone. */
export async function openLocalGarden(
  root: FileSystemDirectoryHandle,
  garden: LocalGarden
): Promise<LocalFolderStore | null> {
  try {
    const dir = await root.getDirectoryHandle(garden.id, { create: false })
    return new LocalFolderStore(dir)
  } catch {
    // Deleted or renamed outside Tend; the caller offers to forget it.
    return null
  }
}

/**
 * Unlock an encrypted garden: unwrapping the stored identity *is* the
 * passphrase check, exactly as on the server.
 *
 * Returns the identity for the caller to keep in memory. Nothing here is
 * persisted — not the passphrase, not the unwrapped key.
 */
export async function unlockLocalGarden(
  store: LocalFolderStore,
  passphrase: string
): Promise<string> {
  const wrapped = await store.read('.tend/identity.age')
  if (!wrapped) throw new Error('This garden has no identity file; it may not be encrypted')

  const wasm = await loadWasm()
  return wasm.unwrap_identity(wrapped.bytes, passphrase)
}

/**
 * Forget a garden: it leaves Tend's list, and its files are left exactly where
 * they are. Deleting someone's notes is never a side effect of tidying a list.
 */
export async function forgetLocalGarden(registry: RegistryStore, id: string): Promise<void> {
  await registry.removeGarden(id)
}
