// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// The seam between a garden folder and a Page, both plain and encrypted.
//
// What matters here is that a garden written by the browser is one the server
// would have written: the same paths, the same filenames, the same bytes. The
// Rust interop suite proves the bridge agrees with the server; these checks
// prove this layer uses the bridge rather than guessing.

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { FakeDirectoryHandle } from './handleFake'
import { LocalFolderStore, StaleWriteError } from './LocalFolderStore'
import {
  BUILT_IN_CONTENT_TYPES,
  deleteSheet,
  existingSheetPath,
  filedUnder,
  findContentType,
  listSheetRefs,
  qualifiedName,
  splitName,
  readContentTypes,
  readGardenJson,
  readSheet,
  readTemplate,
  sheetPath,
  writeContentTypes,
  writeGardenJson,
  writeSheet,
  writeTemplate,
  type GardenSession,
} from './gardenFiles'
import type { ContentType } from '../api'
import type { Page } from '../../types'

const wasmPath = fileURLToPath(new URL('../wasm/generated/tend_wasm_bg.wasm', import.meta.url))
const built = existsSync(wasmPath)

const PAGE_TYPE = BUILT_IN_CONTENT_TYPES[0]
const JOURNAL_TYPE = BUILT_IN_CONTENT_TYPES[1]
const MEETING_TYPE: ContentType = {
  id: 'meeting',
  name: 'Meeting',
  directory: 'meetings',
  organization: 'dateFoldered',
  template: '',
}
const BOOK_TYPE: ContentType = {
  id: 'book',
  name: 'Book',
  directory: 'books',
  organization: 'namespaced',
  template: '',
}

describe.skipIf(!built)('garden files', () => {
  let wasm: Awaited<ReturnType<typeof import('../wasm').loadWasm>>

  beforeAll(async () => {
    const { loadWasm } = await import('../wasm')
    wasm = await loadWasm(readFileSync(wasmPath))
  })

  /** A plain garden, optionally seeded with files. */
  function plain(seed: Record<string, string | Uint8Array> = {}) {
    const root = FakeDirectoryHandle.create(seed)
    const session: GardenSession = {
      id: 'notes',
      store: new LocalFolderStore(root.asHandle()),
      encrypted: false,
    }
    return { root, session }
  }

  /** An encrypted garden with a real identity, already unlocked. */
  function encrypted(seed: Record<string, string | Uint8Array> = {}) {
    const root = FakeDirectoryHandle.create(seed)
    const identity = wasm.generate_identity()
    const session: GardenSession = {
      id: 'secrets',
      store: new LocalFolderStore(root.asHandle()),
      encrypted: true,
      identity,
    }
    return { root, session, identity }
  }

  /** A one-block page, as the editor would hand it over. */
  function page(name: string, content: string, over: Partial<Page> = {}): Page {
    const uuid = '11111111-1111-4111-8111-111111111111'
    return {
      name,
      title: name,
      rootBlocks: [uuid],
      blocks: {
        [uuid]: {
          uuid,
          content,
          parentUuid: null,
          children: [],
          collapsed: false,
          properties: {},
          depth: 0,
        },
      },
      properties: {},
      contentType: 'page',
      isJournal: false,
      journalDate: null,
      createdAt: '2026-10-29T00:00:00Z',
      modifiedAt: '2026-10-29T00:00:00Z',
      version: 1,
      ...over,
    }
  }

  describe('paths', () => {
    it('puts a sheet where the server would, in both gardens', async () => {
      const { session } = plain()
      expect(await sheetPath(session, PAGE_TYPE, 'Shopping')).toBe('pages/Shopping.md')
      expect(await sheetPath(session, PAGE_TYPE, '1:1 Jamie Parker')).toBe(
        'pages/1%3A1 Jamie Parker.md'
      )
      expect(await sheetPath(session, BOOK_TYPE, 'MyBook/Chapter 14')).toBe(
        'books/MyBook/Chapter 14.md'
      )

      const { session: enc } = encrypted()
      expect(await sheetPath(enc, PAGE_TYPE, 'Shopping')).toBe('pages/Shopping.md.age')
    })

    it('files a date-foldered sheet under today when no date is given', async () => {
      const { session } = plain()
      const today = filedUnder(MEETING_TYPE)!
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(await sheetPath(session, MEETING_TYPE, 'Standup')).toBe(
        `meetings/${today}/Standup.md`
      )
      expect(await sheetPath(session, MEETING_TYPE, 'Standup', '2025-01-18')).toBe(
        'meetings/2025-01-18/Standup.md'
      )
    })

    it('leaves a flat type dateless', () => {
      expect(filedUnder(PAGE_TYPE)).toBeUndefined()
      expect(filedUnder(PAGE_TYPE, '2025-01-18')).toBe('2025-01-18')
    })

    it('finds a legacy un-encoded filename', async () => {
      // Written before filename encoding existed; the server still reads it.
      const { session } = plain({ 'pages/1:1 Jamie Parker.md': '- hello\n' })
      expect(await existingSheetPath(session, PAGE_TYPE, '1:1 Jamie Parker')).toBe(
        'pages/1:1 Jamie Parker.md'
      )
    })

    it('has no path for a sheet that is not there', async () => {
      const { session } = plain()
      expect(await existingSheetPath(session, PAGE_TYPE, 'Nothing')).toBeNull()
    })
  })

  describe('reading and writing a sheet', () => {
    it('round-trips a page through a plain garden', async () => {
      const { root, session } = plain()
      await writeSheet(session, PAGE_TYPE, page('Shopping', 'milk'))

      expect(Object.keys(root.snapshot())).toEqual(['pages/Shopping.md'])
      const loaded = await readSheet(session, PAGE_TYPE, 'Shopping')
      expect(loaded!.page.name).toBe('Shopping')
      expect(Object.values(loaded!.page.blocks)[0].content).toBe('milk')
      expect(loaded!.page.contentType).toBe('page')
    })

    it('writes bytes only age can read in an encrypted garden', async () => {
      const { root, session, identity } = encrypted()
      await writeSheet(session, PAGE_TYPE, page('Shopping', 'the quiet part'))

      const bytes = root.bytesAt('pages/Shopping.md.age')!
      const text = new TextDecoder().decode(bytes)
      expect(text).toContain('age-encryption.org')
      expect(text).not.toContain('the quiet part')

      // Decryptable with the garden's identity, and only with it.
      expect(wasm.decrypt_with_identity(bytes, identity)).toContain('the quiet part')
      expect(() => wasm.decrypt_with_identity(bytes, wasm.generate_identity())).toThrow()

      const loaded = await readSheet(session, PAGE_TYPE, 'Shopping')
      expect(Object.values(loaded!.page.blocks)[0].content).toBe('the quiet part')
    })

    it('refuses to read an encrypted garden that is locked', async () => {
      const { session } = encrypted()
      await writeSheet(session, PAGE_TYPE, page('Shopping', 'milk'))

      const locked: GardenSession = { ...session, identity: undefined }
      await expect(readSheet(locked, PAGE_TYPE, 'Shopping')).rejects.toThrow(/locked/)
      await expect(
        writeSheet(locked, PAGE_TYPE, page('Shopping', 'milk'))
      ).rejects.toThrow(/locked/)
    })

    it('refuses a write when the file changed underneath it', async () => {
      const { root, session } = plain()
      const first = await writeSheet(session, PAGE_TYPE, page('Shopping', 'milk'))

      // Another program edits the file.
      root.seedFile('pages/Shopping.md', '- someone else was here\n')

      await expect(
        writeSheet(session, PAGE_TYPE, page('Shopping', 'oat'), undefined, first)
      ).rejects.toThrow(StaleWriteError)

      // The other program's edit is still there.
      expect(root.snapshot()['pages/Shopping.md']).toContain('someone else was here')
    })

    it('updates a legacy filename in place rather than shadowing it', async () => {
      const { root, session } = plain({ 'pages/1:1 Jamie Parker.md': '- old\n' })
      await writeSheet(session, PAGE_TYPE, page('1:1 Jamie Parker', 'new'))

      expect(Object.keys(root.snapshot())).toEqual(['pages/1:1 Jamie Parker.md'])
      expect(root.snapshot()['pages/1:1 Jamie Parker.md']).toContain('new')
    })

    it('writes a dated sheet into its date folder and reads it back', async () => {
      const { root, session } = plain()
      const meeting = page('meetings/2025-01-18/Standup', 'agenda', {
        contentType: 'meeting',
        title: 'Standup',
        journalDate: '2025-01-18',
      })
      await writeSheet(session, MEETING_TYPE, meeting, '2025-01-18')

      expect(Object.keys(root.snapshot())).toEqual(['meetings/2025-01-18/Standup.md'])
      const loaded = await readSheet(session, MEETING_TYPE, 'Standup', '2025-01-18')
      expect(loaded!.page.journalDate).toBe('2025-01-18')
    })

    it('deletes a sheet, and says nothing about one already gone', async () => {
      const { root, session } = plain()
      await writeSheet(session, PAGE_TYPE, page('Shopping', 'milk'))
      await deleteSheet(session, PAGE_TYPE, 'Shopping')
      expect(root.snapshot()).toEqual({})
      await expect(deleteSheet(session, PAGE_TYPE, 'Shopping')).resolves.toBeUndefined()
    })
  })

  describe('listing', () => {
    it('derives names and dates from filenames alone', async () => {
      const { session } = plain({
        'pages/Shopping.md': '- milk\n',
        'pages/1%3A1 Jamie Parker.md': '- notes\n',
        'pages/notes.txt': 'not a sheet',
        'journals/2026-10-29.md': '- today\n',
        'journals/Shopping.md': '- not a journal\n',
        'meetings/2025-01-18/Standup.md': '- agenda\n',
        'books/MyBook/Chapter 14.md': '- once upon\n',
      })

      const pages = await listSheetRefs(session, PAGE_TYPE)
      expect(pages.map((r) => r.name).sort()).toEqual(['1:1 Jamie Parker', 'Shopping'])

      const journals = await listSheetRefs(session, JOURNAL_TYPE)
      expect(journals.map((r) => r.name)).toEqual(['2026-10-29'])

      const meetings = await listSheetRefs(session, MEETING_TYPE)
      expect(meetings).toEqual([
        { name: 'Standup', date: '2025-01-18', path: 'meetings/2025-01-18/Standup.md' },
      ])

      const books = await listSheetRefs(session, BOOK_TYPE)
      expect(books.map((r) => r.name)).toEqual(['MyBook/Chapter 14'])
    })

    it('lists an encrypted garden without decrypting anything', async () => {
      const { session } = encrypted()
      await writeSheet(session, PAGE_TYPE, page('Shopping', 'milk'))

      // No identity: a listing must still work, since it reads filenames only.
      const locked: GardenSession = { ...session, identity: undefined }
      const refs = await listSheetRefs(locked, PAGE_TYPE)
      expect(refs).toEqual([{ name: 'Shopping', date: null, path: 'pages/Shopping.md.age' }])
    })

    it('agrees with the bridge on the canonical name', async () => {
      // A built-in flat type's canonical name is the BARE name: no prefix. Only
      // custom types are directory-prefixed. Getting this wrong would break
      // every backlink, which is why it comes from the bridge.
      expect(await qualifiedName(PAGE_TYPE, 'Shopping')).toBe('Shopping')
      expect(await qualifiedName(JOURNAL_TYPE, '2026-10-29')).toBe('2026-10-29')
      expect(await qualifiedName(MEETING_TYPE, 'Standup', '2025-01-18')).toBe(
        'meetings/2025-01-18/Standup'
      )
      expect(await qualifiedName(BOOK_TYPE, 'MyBook/Chapter 14')).toBe('books/MyBook/Chapter 14')
    })

    it('recovers the bare name a canonical name was built from', async () => {
      expect(await splitName(PAGE_TYPE, 'Shopping')).toEqual({ name: 'Shopping', date: null })
      expect(await splitName(MEETING_TYPE, 'meetings/2025-01-18/Standup')).toEqual({
        name: 'Standup',
        date: '2025-01-18',
      })
      expect(await splitName(BOOK_TYPE, 'books/MyBook/Chapter 14')).toEqual({
        name: 'MyBook/Chapter 14',
        date: null,
      })
    })
  })

  describe('content types', () => {
    it('defaults to pages and journals in a folder with no config', async () => {
      const { session } = plain()
      expect(await readContentTypes(session)).toEqual(BUILT_IN_CONTENT_TYPES)
    })

    it('round-trips custom types as plain JSON the server can read', async () => {
      const { root, session } = plain()
      const types = [...BUILT_IN_CONTENT_TYPES, MEETING_TYPE]
      await writeContentTypes(session, types)

      // Plain even in an encrypted garden's sibling: no note content in it.
      expect(root.snapshot()['.tend/content-types.json']).toContain('"meeting"')
      expect(await readContentTypes(session)).toEqual(types)
    })

    it('falls back to the built-ins rather than refusing to open', async () => {
      const { session } = plain({ '.tend/content-types.json': '{ not json' })
      expect(await readContentTypes(session)).toEqual(BUILT_IN_CONTENT_TYPES)
    })

    it('accepts the wrapped shape the server writes', async () => {
      const { session } = plain({
        '.tend/content-types.json': JSON.stringify({ content_types: [MEETING_TYPE] }),
      })
      expect(await readContentTypes(session)).toEqual([MEETING_TYPE])
    })

    it('names the type it cannot find', () => {
      expect(() => findContentType(BUILT_IN_CONTENT_TYPES, 'meeting')).toThrow(/'meeting'/)
      expect(findContentType(BUILT_IN_CONTENT_TYPES, 'page')).toBe(PAGE_TYPE)
    })
  })

  describe('templates', () => {
    it('round-trips a template, encrypted with the garden', async () => {
      const { root, session } = encrypted()
      await writeTemplate(session, 'meeting', '- TODO {{cursor}}\n')

      const raw = root.snapshot()['.tend/templates/meeting.md.age']
      expect(raw).toContain('age-encryption.org')
      expect(raw).not.toContain('cursor')
      expect((await readTemplate(session, 'meeting'))!.text).toBe('- TODO {{cursor}}\n')
    })

    it('has no template for a type without one', async () => {
      const { session } = plain()
      expect(await readTemplate(session, 'meeting')).toBeNull()
    })
  })

  describe('per-garden JSON', () => {
    it('keeps UI state in the folder, encrypted when the garden is', async () => {
      const { root, session } = encrypted()
      await writeGardenJson(session, 'ui-state', { recentSheets: ['Dinner party seating'] })

      // The file name says .age, and the contents do not leak the title.
      const raw = root.snapshot()['.tend/ui-state.json.age']
      expect(raw).toContain('age-encryption.org')
      expect(raw).not.toContain('Dinner party seating')

      expect(await readGardenJson(session, 'ui-state')).toEqual({
        recentSheets: ['Dinner party seating'],
      })
    })

    it('writes plain JSON for a plain garden', async () => {
      const { root, session } = plain()
      await writeGardenJson(session, 'ui-state', { recentSheets: ['Shopping'] })
      expect(root.snapshot()['.tend/ui-state.json']).toContain('Shopping')
    })

    it('treats a corrupt file as no state rather than failing to open', async () => {
      const { session } = plain({ '.tend/ui-state.json': '{ not json' })
      expect(await readGardenJson(session, 'ui-state')).toBeNull()
    })

    it('has no state before anything is written', async () => {
      const { session } = plain()
      expect(await readGardenJson(session, 'ui-state')).toBeNull()
    })
  })

  describe('the server can open what the browser wrote', () => {
    it('produces the file bytes the serializer produces', async () => {
      // Byte-equality with the bridge's own serializer is what makes the folder
      // an ordinary garden; the Rust interop suite ties the bridge to the server.
      const { root, session } = plain()
      const written = page('Shopping', 'milk')
      await writeSheet(session, PAGE_TYPE, written)

      expect(root.snapshot()['pages/Shopping.md']).toBe(
        wasm.serialize_page(JSON.stringify(written))
      )
    })

    it('round-trips a unicode name and a unicode body', async () => {
      const { root, session } = plain()
      await writeSheet(session, PAGE_TYPE, page('日本語のページ', 'ünïcode — dash 🌱'))

      expect(Object.keys(root.snapshot())).toEqual(['pages/日本語のページ.md'])
      const loaded = await readSheet(session, PAGE_TYPE, '日本語のページ')
      expect(Object.values(loaded!.page.blocks)[0].content).toBe('ünïcode — dash 🌱')
    })

    it('preserves block structure and properties through a round trip', async () => {
      const { session } = plain()
      const parent = '11111111-1111-4111-8111-111111111111'
      const child = '22222222-2222-4222-8222-222222222222'
      const nested: Page = {
        ...page('Project', 'root'),
        rootBlocks: [parent],
        blocks: {
          [parent]: {
            uuid: parent,
            content: 'TODO ship it',
            parentUuid: null,
            children: [child],
            collapsed: true,
            properties: { priority: '1' },
            depth: 0,
          },
          [child]: {
            uuid: child,
            content: 'a detail',
            parentUuid: parent,
            children: [],
            collapsed: false,
            properties: {},
            depth: 1,
          },
        },
      }
      await writeSheet(session, PAGE_TYPE, nested)

      const loaded = await readSheet(session, PAGE_TYPE, 'Project')
      expect(loaded!.page.rootBlocks).toEqual([parent])
      expect(loaded!.page.blocks[parent].children).toEqual([child])
      expect(loaded!.page.blocks[parent].collapsed).toBe(true)
      expect(loaded!.page.blocks[parent].properties).toEqual({ priority: '1' })
      expect(loaded!.page.blocks[child].parentUuid).toBe(parent)
    })
  })

  describe('an encrypted garden really is encrypted', () => {
    it('leaves no note content in the folder in the clear', async () => {
      const { root, session } = encrypted()
      await writeSheet(session, PAGE_TYPE, page('Shopping', 'SECRETBODY'))
      await writeTemplate(session, 'page', 'SECRETTEMPLATE')
      await writeGardenJson(session, 'ui-state', { recentSheets: ['SECRETTITLE'] })

      const everything = Object.values(root.snapshot()).join('\n')
      for (const secret of ['SECRETBODY', 'SECRETTEMPLATE', 'SECRETTITLE']) {
        expect(everything).not.toContain(secret)
      }
    })
  })
})

describe.skipIf(built)('garden files', () => {
  it.skip('not built — run `make wasm` to include these checks', () => {})
})
