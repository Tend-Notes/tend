// SPDX-License-Identifier: MIT WITH Commons-Clause

import { describe, it, expect } from 'vitest'
import { FakeDirectoryHandle } from './handleFake'
import {
  LocalFolderStore,
  StaleWriteError,
  FolderUnavailableError,
  splitPath,
} from './LocalFolderStore'

function store(seed: Record<string, string | Uint8Array> = {}) {
  const root = FakeDirectoryHandle.create(seed)
  return { root, store: new LocalFolderStore(root.asHandle()) }
}

describe('splitPath', () => {
  it('splits a nested path', () => {
    expect(splitPath('pages/Notes.md')).toEqual({ dirs: ['pages'], name: 'Notes.md' })
    expect(splitPath('meetings/2026-01-01/Standup.md')).toEqual({
      dirs: ['meetings', '2026-01-01'],
      name: 'Standup.md',
    })
  })

  it('handles a bare filename', () => {
    expect(splitPath('README.md')).toEqual({ dirs: [], name: 'README.md' })
  })

  it('rejects traversal', () => {
    // The garden root is a boundary: a name that climbs out of it is a bug or
    // an attack, never a legitimate page name.
    expect(() => splitPath('../outside.md')).toThrow(/\.\./)
    expect(() => splitPath('pages/../../etc/passwd')).toThrow(/\.\./)
    expect(() => splitPath('./here.md')).toThrow(/\./)
    expect(() => splitPath('')).toThrow(/empty/)
    expect(() => splitPath('///')).toThrow(/empty/)
  })
})

describe('reading', () => {
  it('reads a seeded file as bytes and text', async () => {
    const { store: s } = store({ 'pages/Notes.md': '- hello' })

    const bytes = await s.read('pages/Notes.md')
    expect(bytes).not.toBeNull()
    expect(new TextDecoder().decode(bytes!.bytes)).toBe('- hello')

    const text = await s.readText('pages/Notes.md')
    expect(text!.text).toBe('- hello')
    expect(text!.lastModified).toBeGreaterThan(0)
  })

  it('returns null for a missing file rather than throwing', async () => {
    const { store: s } = store()
    expect(await s.read('pages/Nope.md')).toBeNull()
    expect(await s.readText('pages/Nope.md')).toBeNull()
    expect(await s.lastModified('pages/Nope.md')).toBeNull()
    expect(await s.exists('pages/Nope.md')).toBe(false)
  })

  it('returns null when a whole directory is missing', async () => {
    const { store: s } = store()
    expect(await s.read('nosuchdir/deeper/file.md')).toBeNull()
  })

  it('round-trips binary content unchanged', async () => {
    // Encrypted notes are arbitrary bytes, not text; a UTF-8 round trip would
    // corrupt them.
    const cipher = new Uint8Array([0, 1, 2, 250, 251, 255, 0])
    const { store: s } = store()
    await s.write('pages/Secret.md.age', cipher)

    expect(await s.read('pages/Secret.md.age')).toMatchObject({ bytes: cipher })
  })
})

describe('writing', () => {
  it('creates parent directories', async () => {
    const { root, store: s } = store()
    await s.write('meetings/2026-01-01/Standup.md', '- agenda')

    expect(root.snapshot()).toEqual({ 'meetings/2026-01-01/Standup.md': '- agenda' })
  })

  it('overwrites and advances lastModified', async () => {
    const { store: s } = store({ 'pages/A.md': 'first' })

    const before = (await s.readText('pages/A.md'))!.lastModified
    const after = await s.write('pages/A.md', 'second')

    expect((await s.readText('pages/A.md'))!.text).toBe('second')
    expect(after).toBeGreaterThan(before)
  })

  it('accepts a write when the file is unchanged since it was read', async () => {
    const { store: s } = store({ 'pages/A.md': 'first' })
    const read = await s.readText('pages/A.md')

    await expect(
      s.write('pages/A.md', 'second', { expectedLastModified: read!.lastModified })
    ).resolves.toBeGreaterThan(read!.lastModified)
  })

  it('refuses a write when another program changed the file', async () => {
    const { root, store: s } = store({ 'pages/A.md': 'first' })
    const read = await s.readText('pages/A.md')

    // Something else edits the folder between our read and our write.
    root.seedFile('pages/A.md', 'edited elsewhere')

    await expect(
      s.write('pages/A.md', 'ours', { expectedLastModified: read!.lastModified })
    ).rejects.toBeInstanceOf(StaleWriteError)

    // And the other program's content survives: no clobber.
    expect((await s.readText('pages/A.md'))!.text).toBe('edited elsewhere')
  })

  it('allows recreating a file that was deleted since it was read', async () => {
    // Deletion is not a conflicting edit — the user is writing the page again.
    const { store: s } = store({ 'pages/A.md': 'first' })
    const read = await s.readText('pages/A.md')
    await s.delete('pages/A.md')

    await expect(
      s.write('pages/A.md', 'recreated', { expectedLastModified: read!.lastModified })
    ).resolves.toBeGreaterThan(0)
  })

  it('does not publish content until the writable closes', async () => {
    // The real API writes to a swap file; a crash mid-write must leave the
    // previous contents intact. The fake models that, so this pins it.
    const { root, store: s } = store({ 'pages/A.md': 'original' })
    const handle = await root.getFileHandle('pages', { create: false }).catch(() => null)
    expect(handle).toBeNull() // 'pages' is a directory, not a file

    const dir = await root.getDirectoryHandle('pages')
    const file = await dir.getFileHandle('A.md')
    const writable = await file.createWritable()
    await writable.write('half written')

    expect((await s.readText('pages/A.md'))!.text).toBe('original')
    await writable.close()
    expect((await s.readText('pages/A.md'))!.text).toBe('half written')
  })
})

describe('deleting', () => {
  it('removes a file', async () => {
    const { root, store: s } = store({ 'pages/A.md': 'x', 'pages/B.md': 'y' })
    await s.delete('pages/A.md')

    expect(root.snapshot()).toEqual({ 'pages/B.md': 'y' })
  })

  it('treats a missing file as already deleted', async () => {
    const { store: s } = store()
    await expect(s.delete('pages/Nope.md')).resolves.toBeUndefined()
    await expect(s.delete('nodir/Nope.md')).resolves.toBeUndefined()
  })
})

describe('listing', () => {
  const garden = {
    'pages/Alpha.md': 'a',
    'pages/Beta.md': 'b',
    'journals/2026-01-01.md': 'j',
    'meetings/2026-01-01/Standup.md': 'm',
    'books/MyNovel/Chapter One.md': 'c',
    'books/MyNovel/About.md': 'd',
    '.tend/identity.age': 'k',
  }

  it('lists one level, marking directories', async () => {
    const { store: s } = store(garden)

    const top = await s.list('')
    expect(top.map((e) => e.name).sort()).toEqual([
      '.tend',
      'books',
      'journals',
      'meetings',
      'pages',
    ])
    expect(top.every((e) => e.isDirectory)).toBe(true)

    const pages = await s.list('pages')
    expect(pages.map((e) => e.name).sort()).toEqual(['Alpha.md', 'Beta.md'])
    expect(pages.every((e) => e.isDirectory)).toBe(false)
  })

  it('lists a missing directory as empty', async () => {
    const { store: s } = store()
    expect(await s.list('pages')).toEqual([])
  })

  it('walks nested content types, returning relative paths', async () => {
    const { store: s } = store(garden)

    expect((await s.listFiles('pages')).sort()).toEqual(['Alpha.md', 'Beta.md'])
    expect((await s.listFiles('meetings')).sort()).toEqual(['2026-01-01/Standup.md'])
    expect((await s.listFiles('books')).sort()).toEqual([
      'MyNovel/About.md',
      'MyNovel/Chapter One.md',
    ])
  })

  it('walks the whole garden from the root', async () => {
    const { store: s } = store(garden)
    expect((await s.listFiles('')).sort()).toEqual(Object.keys(garden).sort())
  })
})

describe('permissions', () => {
  it('reports a granted folder as available', async () => {
    const { store: s } = store({ 'pages/A.md': 'x' })
    expect(await s.permission()).toBe('granted')
    expect(await s.isAvailable()).toBe(true)
  })

  it('needs a request after a restart drops the grant', async () => {
    // What actually happens: the handle survives in IndexedDB, the grant does
    // not, so startup finds 'prompt' and has to ask from a user gesture.
    const { root, store: s } = store({ 'pages/A.md': 'x' })
    root.setPermission('prompt')

    expect(await s.permission()).toBe('prompt')
    expect(await s.isAvailable()).toBe(false)

    expect(await s.ensurePermission()).toBe(true)
    expect(root.permissionRequests).toBe(1)
    expect(await s.isAvailable()).toBe(true)
  })

  it('does not prompt when permission is already granted', async () => {
    const { root, store: s } = store()
    expect(await s.ensurePermission()).toBe(true)
    expect(root.permissionRequests).toBe(0)
  })

  it('reports refusal rather than throwing', async () => {
    const { root, store: s } = store()
    root.setPermission('prompt', 'denied')

    expect(await s.ensurePermission()).toBe(false)
    expect(await s.isAvailable()).toBe(false)
  })

  it('reports a folder that was deleted or moved away', async () => {
    const { root, store: s } = store({ 'pages/A.md': 'x' })
    root.vanish()

    expect(await s.isAvailable()).toBe(false)
  })

  it('surfaces a write to a folder it can no longer reach', async () => {
    const { root, store: s } = store({ 'pages/A.md': 'x' })
    root.vanish()

    await expect(s.write('pages/A.md', 'y')).rejects.toBeInstanceOf(FolderUnavailableError)
  })
})

describe('folderName', () => {
  it('exposes the folder name for display', async () => {
    const { store: s } = store()
    expect(s.folderName).toBe('garden')
  })
})
