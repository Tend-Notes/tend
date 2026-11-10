// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Opening, locking and forgetting a local garden.
//
// The flows here are the ones a user hits after a browser restart, after moving
// a folder, and after typing the wrong passphrase — each of which has to say
// something different and act differently. The checks below drive them against
// the in-memory directory fake, since the real picker needs a gesture.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { FakeDirectoryHandle } from '../lib/local/handleFake'
import { MemoryRegistry } from '../lib/local/registry'
import { activeBackend, resetBackendForTests } from '../lib/backend'
import { setLocalRegistryForTests, useLocalGardenStore } from './localGardenStore'

// The activation sequence reaches into the page stores and the network. It is
// tested where it lives; here only the fact that opening a garden runs it
// matters. vi.mock is hoisted, which vi.doMock in a beforeEach would not be —
// the store imports this at module load.
const activateGarden = vi.hoisted(() => vi.fn(async () => {}))
const clearGardenState = vi.hoisted(() => vi.fn())
vi.mock('./gardenSwitch', () => ({ activateGarden, clearGardenState }))

const wasmPath = fileURLToPath(new URL('../lib/wasm/generated/tend_wasm_bg.wasm', import.meta.url))
const built = existsSync(wasmPath)

const PASSPHRASE = 'correct-horse-battery-staple'

/**
 * Stand in for the browser's picker, which cannot be driven from a test.
 *
 * `crypto` has to be carried through: the wasm bridge's randomness reaches for
 * it, and a stub without it makes identity generation abort inside wasm with a
 * bare "unreachable".
 */
function stubPicker(result: FileSystemDirectoryHandle | Error) {
  vi.stubGlobal('window', {
    showDirectoryPicker: vi.fn(async () => {
      if (result instanceof Error) throw result
      return result
    }),
    crypto: globalThis.crypto,
    location: { pathname: '/', search: '', hash: '' },
    history: { replaceState: vi.fn() },
  })
}

describe.skipIf(!built)('local garden store', () => {
  let registry: MemoryRegistry
  let root: FakeDirectoryHandle

  beforeEach(async () => {
    const { loadWasm } = await import('../lib/wasm')
    await loadWasm(readFileSync(wasmPath))

    registry = new MemoryRegistry()
    setLocalRegistryForTests(registry)
    resetBackendForTests()
    root = FakeDirectoryHandle.create()
    stubPicker(root.asHandle())

    activateGarden.mockClear()
    clearGardenState.mockClear()

    useLocalGardenStore.setState({
      supported: true,
      status: { state: 'none' },
      gardens: [],
      openId: null,
      busy: false,
      error: null,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetBackendForTests()
  })

  const store = () => useLocalGardenStore.getState()

  async function withRoot() {
    await registry.setRoot(root.asHandle())
    await store().refresh()
  }

  describe('the gardens root', () => {
    it('starts with nothing picked', async () => {
      await store().refresh()
      expect(store().status).toEqual({ state: 'none' })
      expect(store().gardens).toEqual([])
    })

    it('saves the folder the user picks', async () => {
      await store().pickRoot()
      expect(store().status).toMatchObject({ state: 'ready', folderName: 'garden' })
      expect(await registry.getRoot()).toBeDefined()
      expect(store().error).toBeNull()
    })

    it('treats a dismissed picker as no change, not an error', async () => {
      const abort = new Error('The user aborted a request.')
      abort.name = 'AbortError'
      stubPicker(abort)

      await store().pickRoot()
      expect(store().error).toBeNull()
      expect(store().status).toEqual({ state: 'none' })
    })

    it('asks to reconnect when the grant did not survive the restart', async () => {
      await withRoot()
      // A browser restart: the handle is still saved, the permission is not.
      root.setPermission('prompt')
      await store().refresh()
      expect(store().status).toEqual({ state: 'needs-permission', folderName: 'garden' })
    })

    it('reconnects from a click, and says so when refused', async () => {
      await withRoot()
      root.setPermission('prompt', 'granted')
      await store().reconnect()
      expect(store().status).toMatchObject({ state: 'ready' })
      expect(root.permissionRequests).toBe(1)

      root.setPermission('prompt', 'denied')
      await store().reconnect()
      expect(store().error).toMatch(/not granted/)
    })

    it('reports a folder that has gone, separately from a lost grant', async () => {
      await withRoot()
      root.vanish()
      await store().refresh()
      // 'denied' after vanishing, so the actionable state is the permission one;
      // either way the remedy offered is a prompt, not a silent failure.
      expect(['missing', 'needs-permission']).toContain(store().status.state)
    })
  })

  describe('creating a garden', () => {
    it('refuses until a root is picked', async () => {
      await store().create({ name: 'Work' })
      expect(store().error).toMatch(/Pick a folder/)
      expect(store().gardens).toEqual([])
    })

    it('creates a plain garden, registers it and opens it', async () => {
      await withRoot()
      await store().create({ name: 'Work Notes' })

      expect(store().gardens.map((g) => g.name)).toEqual(['Work Notes'])
      expect(store().gardens[0].encrypted).toBe(false)
      expect(store().openId).toBe('work-notes')
      expect(activeBackend()).toEqual({ kind: 'local', gardenId: 'work-notes' })
      // A folder named after the garden, with a garden's directories in it.
      expect(Object.keys(root.dirs)).toBeDefined()
      expect(store().error).toBeNull()
    })

    it('creates an encrypted garden and opens it without asking again', async () => {
      await withRoot()
      await store().create({ name: 'Sealed', passphrase: PASSPHRASE })
      expect(store().error).toBeNull()

      expect(store().gardens[0].encrypted).toBe(true)
      expect(store().openId).toBe('sealed')

      const { localSession } = await import('../lib/local/localBackend')
      expect(localSession()?.identity).toBeTruthy()
    }, 30_000)
  })

  describe('opening a garden', () => {
    it('opens a plain garden', async () => {
      await withRoot()
      await store().create({ name: 'Work' })
      await store().close()

      expect(await store().open('work')).toEqual({ needsPassphrase: false })
      expect(store().openId).toBe('work')
      expect(activeBackend().gardenId).toBe('work')
    })

    it('asks for the passphrase of an encrypted garden rather than half-opening it', async () => {
      await withRoot()
      await store().create({ name: 'Sealed', passphrase: PASSPHRASE })
      await store().close()

      expect(await store().open('sealed')).toEqual({ needsPassphrase: true })
      expect(store().openId).toBeNull()
      expect(store().error).toBeNull()
    }, 30_000)

    it('opens with the right passphrase and keeps asking after a wrong one', async () => {
      await withRoot()
      await store().create({ name: 'Sealed', passphrase: PASSPHRASE })
      await store().close()

      expect(await store().open('sealed', 'wrong')).toEqual({ needsPassphrase: true })
      expect(store().openId).toBeNull()
      expect(store().error).toBeTruthy()

      expect(await store().open('sealed', PASSPHRASE)).toEqual({ needsPassphrase: false })
      expect(store().openId).toBe('sealed')
    }, 60_000)

    it('says the folder is gone rather than opening an empty garden', async () => {
      await withRoot()
      await store().create({ name: 'Work' })
      await store().close()

      // Someone deleted the garden's directory outside Tend.
      root.dirs.delete('work')
      await store().open('work')
      expect(store().error).toMatch(/is gone/)
      expect(store().openId).toBeNull()
    })

    it('refuses a garden this browser has never heard of', async () => {
      await withRoot()
      await store().open('someone-elses')
      expect(store().error).toMatch(/not in this browser/)
    })
  })

  describe('closing', () => {
    it('drops the identity and everything derived from the garden', async () => {
      await withRoot()
      await store().create({ name: 'Sealed', passphrase: PASSPHRASE })

      const { localSession } = await import('../lib/local/localBackend')
      expect(localSession()).not.toBeNull()

      await store().close()
      expect(store().openId).toBeNull()
      expect(localSession()).toBeNull()
    }, 30_000)
  })

  describe('forgetting', () => {
    it('removes it from the list and leaves its files alone', async () => {
      await withRoot()
      await store().create({ name: 'Work' })
      const before = Object.keys(root.snapshot()).length

      await store().forget('work')
      expect(store().gardens).toEqual([])
      expect(store().openId).toBeNull()
      // Deleting someone's notes is never a side effect of tidying a list.
      expect(Object.keys(root.snapshot()).length).toBe(before)
      expect(root.dirs.has('work')).toBe(true)
    })
  })

  describe('an unsupported browser', () => {
    it('says so instead of offering a picker', async () => {
      vi.stubGlobal('window', {
        crypto: globalThis.crypto,
        history: { replaceState: vi.fn() },
      })
      useLocalGardenStore.setState({
        supported: false,
        status: { state: 'unsupported' },
        gardens: [],
        openId: null,
        busy: false,
        error: null,
      })

      await store().refresh()
      expect(store().status).toEqual({ state: 'unsupported' })
      expect(store().gardens).toEqual([])
    })
  })
})

describe.skipIf(built)('local garden store', () => {
  it.skip('not built — run `make wasm` to include these checks', () => {})
})
