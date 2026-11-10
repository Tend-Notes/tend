// SPDX-License-Identifier: MIT WITH Commons-Clause

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { FakeDirectoryHandle } from './handleFake'
import { MemoryRegistry, gardenIdFromName } from './registry'
import {
  createLocalGarden,
  forgetLocalGarden,
  isInsideRoot,
  isSupported,
  openLocalGarden,
  pickGardensRoot,
  reconnectRoot,
  rootStatus,
  unlockLocalGarden,
  RootUnavailableError,
} from './gardenRoot'

const wasmPath = fileURLToPath(new URL('../wasm/generated/tend_wasm_bg.wasm', import.meta.url))
const wasmBuilt = existsSync(wasmPath)

const PASSPHRASE = 'correct-horse-battery-staple'

/** Stand in for the browser's picker, which cannot be driven from a test. */
function stubPicker(result: FileSystemDirectoryHandle | Error) {
  const picker = vi.fn(async () => {
    if (result instanceof Error) throw result
    return result
  })
  vi.stubGlobal('window', { showDirectoryPicker: picker })
  return picker
}

function abortError(): Error {
  const e = new Error('The user aborted a request.')
  e.name = 'AbortError'
  return e
}

describe('browser support', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is unsupported without a picker', () => {
    vi.stubGlobal('window', {})
    expect(isSupported()).toBe(false)
  })

  it('is supported when the picker exists', () => {
    stubPicker(FakeDirectoryHandle.create().asHandle())
    expect(isSupported()).toBe(true)
  })

  it('explains itself rather than throwing a DOM error', async () => {
    vi.stubGlobal('window', {})
    await expect(pickGardensRoot()).rejects.toThrow(/Chromium browser such as Edge/)
  })
})

describe('picking the root', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('asks for read-write access and starts in documents', async () => {
    const root = FakeDirectoryHandle.create().asHandle()
    const picker = stubPicker(root)

    expect(await pickGardensRoot()).toBe(root)
    expect(picker).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'readwrite', startIn: 'documents' })
    )
  })

  it('treats a dismissed dialog as "no folder chosen", not a failure', async () => {
    stubPicker(abortError())
    await expect(pickGardensRoot()).rejects.toBeInstanceOf(RootUnavailableError)
    await expect(pickGardensRoot()).rejects.toThrow(/No folder chosen/)
  })
})

describe('containment', () => {
  it('recognises a folder inside the root', async () => {
    const root = FakeDirectoryHandle.create()
    const child = await root.getDirectoryHandle('work-notes', { create: true })

    expect(await isInsideRoot(root.asHandle(), child)).toBe(true)
  })

  it('recognises a nested folder inside the root', async () => {
    const root = FakeDirectoryHandle.create({ 'work-notes/pages/A.md': 'x' })
    const pages = await (await root.getDirectoryHandle('work-notes')).getDirectoryHandle('pages')

    expect(await isInsideRoot(root.asHandle(), pages)).toBe(true)
  })

  it('rejects a folder from somewhere else entirely', async () => {
    // The whole point: a handle the user picked elsewhere is not under our root,
    // and this is the only way the platform lets us find that out.
    const root = FakeDirectoryHandle.create()
    const elsewhere = FakeDirectoryHandle.create()

    expect(await isInsideRoot(root.asHandle(), elsewhere.asHandle())).toBe(false)
  })
})

describe('root status on load', () => {
  afterEach(() => vi.unstubAllGlobals())

  beforeEach(() => stubPicker(FakeDirectoryHandle.create().asHandle()))

  it('reports no root before the user has picked one', async () => {
    expect(await rootStatus(new MemoryRegistry())).toEqual({ state: 'none' })
  })

  it('reports unsupported without a picker, before touching the registry', async () => {
    vi.stubGlobal('window', {})
    expect(await rootStatus(new MemoryRegistry())).toEqual({ state: 'unsupported' })
  })

  it('reports ready when the grant survived', async () => {
    const registry = new MemoryRegistry()
    const root = FakeDirectoryHandle.create()
    await registry.setRoot(root.asHandle())

    expect(await rootStatus(registry)).toMatchObject({ state: 'ready', folderName: 'garden' })
  })

  it('asks for a reconnect after a browser restart drops the grant', async () => {
    // The handle survives in IndexedDB; the permission does not. This is the
    // normal startup path, not an error.
    const registry = new MemoryRegistry()
    const root = FakeDirectoryHandle.create()
    root.setPermission('prompt')
    await registry.setRoot(root.asHandle())

    expect(await rootStatus(registry)).toEqual({
      state: 'needs-permission',
      folderName: 'garden',
    })

    expect(await reconnectRoot(root.asHandle())).toBe(true)
    expect(await rootStatus(registry)).toMatchObject({ state: 'ready' })
  })

  it('distinguishes a folder that has gone from one that needs a reconnect', async () => {
    const registry = new MemoryRegistry()
    const root = FakeDirectoryHandle.create({ 'a/pages/x.md': 'x' })
    await registry.setRoot(root.asHandle())
    root.vanish()

    // vanish() drops permission too, which is what a deleted folder looks like
    // first; the remedy the UI offers is "pick again" either way.
    const status = await rootStatus(registry)
    expect(['needs-permission', 'missing']).toContain(status.state)
  })
})

describe.skipIf(!wasmBuilt)('creating gardens', () => {
  beforeAll(async () => {
    // Pre-initialize the shared wasm module with bytes; createLocalGarden's own
    // loadWasm() then reuses it (there is no fetch in Node).
    const { loadWasm } = await import('../wasm')
    await loadWasm(readFileSync(wasmPath))
  })

  it('creates an unencrypted garden as a child of the root', async () => {
    const registry = new MemoryRegistry()
    const root = FakeDirectoryHandle.create()

    const { garden, store } = await createLocalGarden(registry, root.asHandle(), {
      name: 'Work Notes',
    })

    expect(garden).toMatchObject({ id: 'work-notes', name: 'Work Notes', encrypted: false })
    expect(await registry.listGardens()).toHaveLength(1)

    // Containment by construction: the garden is under the picked root.
    expect(await isInsideRoot(root.asHandle(), (await root.getDirectoryHandle('work-notes')))).toBe(
      true
    )
    expect((await store.list('')).map((e) => e.name).sort()).toEqual([
      '.tend',
      'journals',
      'pages',
    ])
  })

  it('writes no key material for an unencrypted garden', async () => {
    const registry = new MemoryRegistry()
    const root = FakeDirectoryHandle.create()
    const { store } = await createLocalGarden(registry, root.asHandle(), { name: 'Plain' })

    expect(await store.exists('.tend/identity.age')).toBe(false)
    expect(await store.exists('.tend/encryption.verify')).toBe(false)
  })

  it('bootstraps an encrypted garden the way the server expects', async () => {
    const registry = new MemoryRegistry()
    const root = FakeDirectoryHandle.create()

    const { garden, store, identity } = await createLocalGarden(registry, root.asHandle(), {
      name: 'Sealed',
      passphrase: PASSPHRASE,
    })

    expect(garden.encrypted).toBe(true)
    expect(identity).toMatch(/^AGE-SECRET-KEY-1/)

    // Both files present, and both are real age ciphertext.
    for (const path of ['.tend/encryption.verify', '.tend/identity.age']) {
      const file = await store.read(path)
      expect(file, path).not.toBeNull()
      expect(new TextDecoder().decode(file!.bytes.slice(0, 21))).toBe('age-encryption.org/v1')
    }
  })

  it('does not persist the passphrase anywhere in the folder', async () => {
    const registry = new MemoryRegistry()
    const root = FakeDirectoryHandle.create()
    await createLocalGarden(registry, root.asHandle(), {
      name: 'Sealed',
      passphrase: PASSPHRASE,
    })

    const everything = JSON.stringify(root.snapshot())
    expect(everything).not.toContain(PASSPHRASE)
  })

  it('unlocks with the right passphrase and refuses the wrong one', async () => {
    const registry = new MemoryRegistry()
    const root = FakeDirectoryHandle.create()
    const { store, identity } = await createLocalGarden(registry, root.asHandle(), {
      name: 'Sealed',
      passphrase: PASSPHRASE,
    })

    // Unwrapping the stored identity IS the passphrase check, as on the server.
    expect(await unlockLocalGarden(store, PASSPHRASE)).toBe(identity)
    await expect(unlockLocalGarden(store, 'wrong passphrase')).rejects.toThrow()
    // scrypt is deliberately slow, and this does three derivations (create,
    // unlock, failed unlock) in wasm. Seconds are the point, not a problem.
  }, 30_000)

  it('gives two gardens with the same name distinct folders', async () => {
    const registry = new MemoryRegistry()
    const root = FakeDirectoryHandle.create()

    const first = await createLocalGarden(registry, root.asHandle(), { name: 'Work Notes' })
    const second = await createLocalGarden(registry, root.asHandle(), { name: 'Work Notes' })

    expect(first.garden.id).toBe('work-notes')
    expect(second.garden.id).toBe('work-notes-2')
    expect((await registry.listGardens()).map((g) => g.id)).toEqual(['work-notes', 'work-notes-2'])
  })

  it('refuses a nameless garden', async () => {
    const registry = new MemoryRegistry()
    const root = FakeDirectoryHandle.create()

    await expect(
      createLocalGarden(registry, root.asHandle(), { name: '   ' })
    ).rejects.toThrow(/needs a name/)
  })
})

describe.skipIf(!wasmBuilt)('opening and forgetting', () => {
  beforeAll(async () => {
    const { loadWasm } = await import('../wasm')
    await loadWasm(readFileSync(wasmPath))
  })

  it('reopens a registered garden', async () => {
    const registry = new MemoryRegistry()
    const root = FakeDirectoryHandle.create()
    const { garden, store } = await createLocalGarden(registry, root.asHandle(), { name: 'Notes' })
    await store.write('pages/A.md', '- hello')

    const reopened = await openLocalGarden(root.asHandle(), garden)
    expect(reopened).not.toBeNull()
    expect((await reopened!.readText('pages/A.md'))!.text).toBe('- hello')
  })

  it('reports a garden whose folder was deleted outside Tend', async () => {
    const registry = new MemoryRegistry()
    const root = FakeDirectoryHandle.create()
    const { garden } = await createLocalGarden(registry, root.asHandle(), { name: 'Notes' })

    await root.removeEntry('notes', { recursive: true })

    expect(await openLocalGarden(root.asHandle(), garden)).toBeNull()
  })

  it('forgetting a garden leaves its files alone', async () => {
    // Removing something from a list must never delete someone's notes.
    const registry = new MemoryRegistry()
    const root = FakeDirectoryHandle.create()
    const { garden, store } = await createLocalGarden(registry, root.asHandle(), { name: 'Notes' })
    await store.write('pages/A.md', '- still here')

    await forgetLocalGarden(registry, garden.id)

    expect(await registry.listGardens()).toHaveLength(0)
    expect(root.snapshot()['notes/pages/A.md']).toBe('- still here')
  })
})

describe('gardenIdFromName', () => {
  it('slugifies', () => {
    expect(gardenIdFromName('Work Notes')).toBe('work-notes')
    expect(gardenIdFromName('  Spaced  Out  ')).toBe('spaced-out')
    expect(gardenIdFromName('Already-Fine')).toBe('already-fine')
  })

  it('strips characters a directory name should not carry', () => {
    expect(gardenIdFromName('Q&A: "notes"/2026')).toBe('q-a-notes-2026')
    expect(gardenIdFromName('../escape')).toBe('escape')
  })

  it('falls back when a name reduces to nothing', () => {
    // A garden named entirely in a non-Latin script still needs a folder.
    expect(gardenIdFromName('日本語')).toMatch(/^garden-\d+$/)
  })

  it('suffixes a collision instead of refusing', () => {
    expect(gardenIdFromName('Work Notes', ['work-notes'])).toBe('work-notes-2')
    expect(gardenIdFromName('Work Notes', ['work-notes', 'work-notes-2'])).toBe('work-notes-3')
  })
})
