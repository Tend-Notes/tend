// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// The local gardens this browser profile knows about, and which one is open.
//
// A local garden is a folder on this machine, reached through a directory
// handle the user granted once. That makes three states the UI has to tell
// apart, because each has a different remedy:
//
//   - **no root** — the user has never picked a gardens folder. Pick one.
//   - **needs permission** — the handle survived, the grant did not (a browser
//     restart drops it). Reconnect, which must come from a click.
//   - **missing** — the folder itself was moved or deleted. Pick again.
//
// And one that is not an error at all: opening Tend on another machine shows no
// local gardens, because the registry and the handle are per browser profile.
// There is nothing to recover and nothing has gone wrong.
//
// What this store does NOT hold: the passphrase, ever, and the unwrapped
// identity, which lives in the backend session for as long as the garden is
// unlocked and is dropped on lock.

import { create } from 'zustand'
import { isDemoMode, setActiveBackend } from '../lib/backend'
import {
  createLocalGarden,
  forgetLocalGarden,
  isSupported,
  openLocalGarden,
  pickGardensRoot,
  reconnectRoot,
  rootStatus,
  unlockLocalGarden,
  type RootStatus,
} from '../lib/local/gardenRoot'
import { IndexedDbRegistry, type LocalGarden, type RegistryStore } from '../lib/local/registry'
import { activateGarden, clearGardenState } from './gardenSwitch'

interface LocalGardenState {
  /** Whether this browser can open local folders at all. */
  supported: boolean
  /** Where the gardens root stands, without having prompted for anything. */
  status: RootStatus
  gardens: LocalGarden[]
  /**
   * False when this browser could not store the chosen folder, so it will have
   * to be picked again next session. The folder works now either way.
   */
  rootRemembered: boolean
  /** The open local garden's id, or null when a server garden is active. */
  openId: string | null
  busy: boolean
  error: string | null

  /** Read the registry and check the root. Safe to call on load. */
  refresh: () => Promise<void>
  /** Ask for the gardens root. MUST be called from a click. */
  pickRoot: () => Promise<void>
  /** Re-grant access to the saved root. MUST be called from a click. */
  reconnect: () => Promise<void>
  create: (options: { name: string; passphrase?: string }) => Promise<void>
  /**
   * Open a garden. An encrypted one needs its passphrase; without it this
   * reports `needsPassphrase` and opens nothing.
   */
  open: (id: string, passphrase?: string) => Promise<{ needsPassphrase: boolean }>
  /**
   * Close the open local garden, dropping its identity and everything derived
   * from it.
   *
   * Awaitable, and awaited, because this is the one action that has to be
   * definite: the caller needs to know the key is gone, not that it will be.
   */
  close: () => Promise<void>
  /** Drop a garden from the list. Its files are left exactly where they are. */
  forget: (id: string) => Promise<void>
  clearError: () => void
}

/** Swappable so the store can be driven in a test without IndexedDB. */
let registry: RegistryStore = new IndexedDbRegistry()

/** Tests only. */
export function setLocalRegistryForTests(next: RegistryStore): void {
  registry = next
}

/**
 * Hand the backend the open garden.
 *
 * Imported lazily, and only on this path, so the wasm bridge and the local
 * backend stay out of the main chunk for anyone who never opens a local garden.
 */
async function backend() {
  return import('../lib/local/localBackend')
}

function message(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback
}

export const useLocalGardenStore = create<LocalGardenState>((set, get) => ({
  supported: isSupported(),
  status: { state: isSupported() ? 'none' : 'unsupported' },
  gardens: [],
  rootRemembered: true,
  openId: null,
  busy: false,
  error: null,

  clearError: () => set({ error: null }),

  refresh: async () => {
    if (!get().supported) return
    try {
      const [status, gardens] = await Promise.all([
        rootStatus(registry),
        registry.listGardens(),
      ])
      set({ status, gardens, rootRemembered: registry.rootPersists(), error: null })
    } catch (e) {
      set({ error: message(e, 'Could not read the local-garden list') })
    }
  },

  pickRoot: async () => {
    set({ busy: true, error: null })
    try {
      const root = await pickGardensRoot()
      await registry.setRoot(root)
      await get().refresh()
    } catch (e) {
      // A dismissed picker is not a failure; it leaves things as they were.
      const text = message(e, 'Could not open the folder picker')
      set({ error: text === 'No folder chosen' ? null : text })
    } finally {
      set({ busy: false })
    }
  },

  reconnect: async () => {
    const root = await registry.getRoot()
    if (!root) return get().pickRoot()

    set({ busy: true, error: null })
    try {
      const granted = await reconnectRoot(root)
      // Refresh first: it clears the error, so a refusal has to be reported
      // after it or the UI shows nothing went wrong.
      await get().refresh()
      if (!granted) set({ error: 'Access to the folder was not granted' })
    } catch (e) {
      set({ error: message(e, 'Could not reconnect to the folder') })
    } finally {
      set({ busy: false })
    }
  },

  create: async ({ name, passphrase }) => {
    const { status } = get()
    if (status.state !== 'ready') {
      set({ error: 'Pick a folder for your local gardens first' })
      return
    }

    set({ busy: true, error: null })
    try {
      const { garden, store, identity } = await createLocalGarden(registry, status.root, {
        name,
        passphrase,
      })
      await get().refresh()

      // A new garden is opened straight away: it was just created with the
      // passphrase, so there is nothing to ask for.
      const { setLocalSession } = await backend()
      setLocalSession({ id: garden.id, store, encrypted: garden.encrypted, identity })
      setActiveBackend({ kind: 'local', gardenId: garden.id })
      set({ openId: garden.id })
      await activateGarden()
    } catch (e) {
      set({ error: message(e, 'Could not create the garden') })
    } finally {
      set({ busy: false })
    }
  },

  open: async (id, passphrase) => {
    const { status, gardens } = get()
    if (status.state !== 'ready') {
      set({ error: 'Reconnect to your gardens folder first' })
      return { needsPassphrase: false }
    }
    const garden = gardens.find((g) => g.id === id)
    if (!garden) {
      set({ error: 'That garden is not in this browser' })
      return { needsPassphrase: false }
    }
    // Ask before touching anything: an encrypted garden cannot be opened
    // without the passphrase, and half-opening it would leave the UI blank.
    if (garden.encrypted && !passphrase) return { needsPassphrase: true }

    set({ busy: true, error: null })
    try {
      const store = await openLocalGarden(status.root, garden)
      if (!store) {
        set({ error: `The folder for "${garden.name}" is gone. Pick it again, or forget it.` })
        return { needsPassphrase: false }
      }

      // Unwrapping the identity IS the passphrase check, as on the server.
      const identity = passphrase ? await unlockLocalGarden(store, passphrase) : undefined

      const { setLocalSession } = await backend()
      setLocalSession({ id: garden.id, store, encrypted: garden.encrypted, identity })
      setActiveBackend({ kind: 'local', gardenId: garden.id })
      set({ openId: garden.id })
      await activateGarden()
      return { needsPassphrase: false }
    } catch (e) {
      // A wrong passphrase lands here, and the garden stays closed.
      set({ error: message(e, 'Could not open the garden') })
      return { needsPassphrase: garden.encrypted }
    } finally {
      set({ busy: false })
    }
  },

  close: async () => {
    if (!get().openId) return
    set({ openId: null })
    // Dropping the session drops the identity and every derived index with it.
    const { setLocalSession } = await backend()
    setLocalSession(null)
    // Back to the server, or every later call is refused by a dispatcher still
    // pointed at a garden that is no longer open.
    setActiveBackend({ kind: isDemoMode ? 'demo' : 'server' })
    clearGardenState()
  },

  forget: async (id) => {
    if (get().openId === id) await get().close()
    try {
      await forgetLocalGarden(registry, id)
      await get().refresh()
    } catch (e) {
      set({ error: message(e, 'Could not forget the garden') })
    }
  },
}))
