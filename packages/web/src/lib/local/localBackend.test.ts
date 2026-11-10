// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// The API as a local garden answers it.
//
// These drive the groups the way the app does — create a sheet, save it, read
// it back, ask what links to it — against an in-memory folder. The layers below
// are tested separately; what matters here is that each group answers in the
// shape the app already expects from the server, and that a write is reflected
// in the next read rather than in a stale scan.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { FakeDirectoryHandle } from './handleFake'
import { LocalFolderStore } from './LocalFolderStore'
import { BUILT_IN_CONTENT_TYPES, type GardenSession } from './gardenFiles'
import {
  blocks,
  contentTypes,
  graph,
  journals,
  links,
  NoLocalGardenError,
  pages,
  search,
  setLocalSession,
  sheets,
  stabilize,
  tags,
  templates,
  todos,
  user,
} from './localBackend'
import { VersionConflictError, type BlockData, type ContentType } from '../api'

const wasmPath = fileURLToPath(new URL('../wasm/generated/tend_wasm_bg.wasm', import.meta.url))
const built = existsSync(wasmPath)

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

/** The payload the editor sends: one block per line. */
function blockData(contents: string[]): BlockData[] {
  return contents.map((content, i) => ({
    uuid: `${String(i + 1).padStart(8, '0')}-0000-4000-8000-000000000000`,
    content,
    parent_uuid: null,
    children: [],
    collapsed: false,
    properties: {},
  }))
}

describe.skipIf(!built)('local backend', () => {
  let root: FakeDirectoryHandle

  beforeAll(async () => {
    const { loadWasm } = await import('../wasm')
    await loadWasm(readFileSync(wasmPath))
  })

  /** A fresh plain garden, opened. */
  function open(seed: Record<string, string> = {}, types?: ContentType[]): GardenSession {
    root = FakeDirectoryHandle.create(seed)
    if (types) {
      root.seedFile('.tend/content-types.json', JSON.stringify(types))
    }
    const session: GardenSession = {
      id: 'notes',
      store: new LocalFolderStore(root.asHandle()),
      encrypted: false,
    }
    setLocalSession(session)
    return session
  }

  beforeEach(() => setLocalSession(null))

  describe('with no garden open', () => {
    it('refuses rather than reading the wrong folder', async () => {
      await expect(pages.list()).rejects.toThrow(NoLocalGardenError)
      await expect(todos.list()).rejects.toThrow(NoLocalGardenError)
      await expect(user.getState()).rejects.toThrow(NoLocalGardenError)
    })
  })

  describe('pages', () => {
    beforeEach(() => open())

    it('creates, lists, reads and deletes', async () => {
      const created = await pages.create('Shopping', 'milk')
      expect(created.name).toBe('Shopping')
      expect(Object.values(created.blocks)[0].content).toBe('milk')

      expect((await pages.list()).map((m) => m.name)).toEqual(['Shopping'])
      expect((await pages.get('Shopping')).name).toBe('Shopping')

      expect(await pages.delete('Shopping')).toEqual({ deleted: 'Shopping' })
      expect(await pages.list()).toEqual([])
    })

    it('saves an edit and bumps the version', async () => {
      await pages.create('Shopping', 'milk')
      const saved = await pages.update('Shopping', blockData(['milk', 'oats']))

      expect(Object.keys(saved.blocks)).toHaveLength(2)
      expect(saved.version).toBe(2)
      // And the next read sees it: the scan was invalidated, not reused.
      expect(Object.keys((await pages.get('Shopping')).blocks)).toHaveLength(2)
      expect((await pages.list())[0].blockCount).toBe(2)
    })

    it('saves a page that is not on disk yet', async () => {
      // The editor can save before a create lands; the server's PUT allows it.
      const saved = await pages.update('Fresh', blockData(['first thought']))
      expect(saved.name).toBe('Fresh')
      expect((await pages.list()).map((m) => m.name)).toEqual(['Fresh'])
    })

    it('reports a missing page rather than inventing one', async () => {
      await expect(pages.get('Nothing')).rejects.toThrow(/not found/)
    })

    it('refuses to create a page twice', async () => {
      await pages.create('Shopping', 'milk')
      await expect(pages.create('Shopping')).rejects.toThrow(/already exists/)
    })

    it('answers backlinks', async () => {
      await pages.create('Shopping', 'milk')
      await pages.create('Project', 'see [[Shopping]]')

      const refs = await pages.getBacklinks('Shopping')
      expect(refs.map((r) => r.pageName)).toEqual(['Project'])
      expect(refs[0].blockContent).toBe('see [[Shopping]]')
    })

    it('raises the conflict dialog when the file changed on disk', async () => {
      await pages.create('Shopping', 'milk')
      // Another program edits the file between the read and the save.
      root.seedFile('pages/Shopping.md', '- someone else was here\n')

      await expect(pages.update('Shopping', blockData(['oats']))).rejects.toThrow(
        VersionConflictError
      )
      expect(root.snapshot()['pages/Shopping.md']).toContain('someone else was here')
    })

    it('refuses a save against a version that has moved on', async () => {
      await pages.create('Shopping', 'milk')
      await expect(pages.update('Shopping', blockData(['oats']), 99)).rejects.toThrow(
        /Version mismatch|current 1/
      )
    })
  })

  describe('journals', () => {
    beforeEach(() => open())

    it('reads and writes a journal by date', async () => {
      const saved = await journals.update('2026-10-29', blockData(['woke up late']))
      expect(saved.isJournal).toBe(true)
      expect(saved.journalDate).toBe('2026-10-29')

      const listed = await journals.list()
      expect(listed.map((m) => m.name)).toEqual(['2026-10-29'])
      expect(listed[0].title).toBe('Thursday, October 29, 2026')
      expect((await journals.get('2026-10-29')).journalDate).toBe('2026-10-29')
    })

    it('keeps journals out of the page listing', async () => {
      await journals.update('2026-10-29', blockData(['today']))
      await pages.create('Shopping', 'milk')
      expect((await pages.list()).map((m) => m.name)).toEqual(['Shopping'])
    })
  })

  describe('sheets of a custom type', () => {
    beforeEach(() => open({}, [...BUILT_IN_CONTENT_TYPES, MEETING_TYPE, BOOK_TYPE]))

    it('files a dated sheet under its date', async () => {
      const created = await sheets.create('meeting', 'Standup', { date: '2026-10-01' })
      expect(created.name).toBe('meetings/2026-10-01/Standup')
      expect(Object.keys(root.snapshot())).toContain('meetings/2026-10-01/Standup.md')

      expect((await sheets.list('meeting')).map((m) => m.name)).toEqual([
        'meetings/2026-10-01/Standup',
      ])
      expect((await sheets.get('meeting', 'Standup', '2026-10-01')).name).toBe(
        'meetings/2026-10-01/Standup'
      )
    })

    it('needs a namespace for a compilation entry', async () => {
      await expect(sheets.create('book', 'Chapter 14')).rejects.toThrow(/needs a namespace/)
      const created = await sheets.create('book', 'MyBook/Chapter 14')
      expect(created.name).toBe('books/MyBook/Chapter 14')
      expect(created.title).toBe('MyBook/Chapter 14')
    })

    it('creates a compilation by writing its About stub, once', async () => {
      const first = await sheets.createCompilation('book', 'MyBook')
      expect(first).toEqual({
        namespace: 'MyBook',
        about_path: 'books/MyBook/About',
        existed: false,
      })
      expect(Object.keys(root.snapshot())).toContain('books/MyBook/About.md')
      expect(root.snapshot()['books/MyBook/About.md']).toContain('"MyBook" compilation')

      // Idempotent: asking again reports what is already there.
      expect((await sheets.createCompilation('book', 'MyBook')).existed).toBe(true)
    })

    it('refuses a compilation on a type that has none, or a bad name', async () => {
      await expect(sheets.createCompilation('page', 'MyBook')).rejects.toThrow(
        /namespaced content types/
      )
      await expect(sheets.createCompilation('book', '  ')).rejects.toThrow(/cannot be empty/)
      await expect(sheets.createCompilation('book', 'a/b')).rejects.toThrow(/contain '\/'/)
      await expect(sheets.createCompilation('book', '..')).rejects.toThrow()
    })

    it('merges page properties on save, leaving others alone', async () => {
      await sheets.create('meeting', 'Standup', { date: '2026-10-01' })
      const saved = await sheets.update(
        'meeting',
        'Standup',
        blockData(['agenda']),
        undefined,
        '2026-10-01',
        { longform: 'true' }
      )
      expect(saved.properties.longform).toBe('true')

      const cleared = await sheets.update(
        'meeting',
        'Standup',
        blockData(['agenda']),
        undefined,
        '2026-10-01',
        { longform: null }
      )
      expect(cleared.properties.longform).toBeUndefined()
    })

    it('deletes a dated sheet', async () => {
      await sheets.create('meeting', 'Standup', { date: '2026-10-01' })
      expect(await sheets.delete('meeting', 'Standup', '2026-10-01')).toEqual({
        deleted: 'Standup',
        contentType: 'meeting',
      })
      expect(await sheets.list('meeting')).toEqual([])
    })

    it('names a content type it does not have', async () => {
      await expect(sheets.list('nope')).rejects.toThrow(/'nope'/)
    })
  })

  describe('templates', () => {
    beforeEach(() => open({}, [...BUILT_IN_CONTENT_TYPES, MEETING_TYPE]))

    it('instantiates a saved template, reporting where the caret goes', async () => {
      await templates.update('meeting', blockData(['## Agenda', 'TODO {{cursor}}']))

      const created = await sheets.create('meeting', 'Standup', { date: '2026-10-01' })
      const contents = Object.values(created.blocks).map((b) => b.content)
      expect(contents).toContain('## Agenda')
      expect(contents).toContain('TODO ')
      expect(contents.join()).not.toContain('{{cursor}}')

      expect(created.cursorPosition).toBeDefined()
      expect(created.blocks[created.cursorPosition!.blockUuid].content).toBe('TODO ')
      expect(created.cursorPosition!.offset).toBe(5)
    })

    it('reads back an empty template for a type that has none', async () => {
      const page = await templates.get('meeting')
      expect(Object.keys(page.blocks)).toHaveLength(0)
    })

    it('falls back to the type’s configured template string', async () => {
      open({}, [
        ...BUILT_IN_CONTENT_TYPES,
        { ...MEETING_TYPE, template: 'Attendees: {{cursor}}' },
      ])
      const created = await sheets.create('meeting', 'Standup', { date: '2026-10-01' })
      expect(Object.values(created.blocks)[0].content).toBe('Attendees: ')
      expect(created.cursorPosition!.offset).toBe(11)
    })

    it('places the caret in content handed over directly', async () => {
      const created = await sheets.create('meeting', 'Standup', {
        date: '2026-10-01',
        content: 'TODO {{cursor}}call back',
      })
      expect(Object.values(created.blocks)[0].content).toBe('TODO call back')
      expect(created.cursorPosition!.offset).toBe(5)
    })
  })

  describe('content types', () => {
    it('defaults to pages and journals', async () => {
      open()
      expect(await contentTypes.list()).toEqual(BUILT_IN_CONTENT_TYPES)
    })

    it('saves a new type and serves it immediately', async () => {
      open()
      const next = [...BUILT_IN_CONTENT_TYPES, MEETING_TYPE]
      expect(await contentTypes.update(next)).toEqual(next)
      // The scan picks it up without reopening the garden.
      expect(await sheets.list('meeting')).toEqual([])
    })
  })

  describe('derived groups', () => {
    beforeEach(async () => {
      open()
      await pages.create('Shopping', 'milk')
      await pages.create('Project', 'TODO ship it')
      await pages.update('Project', blockData(['TODO ship it', 'see [[Shopping]]', '#work']))
    })

    it('lists tags, tasks, wikilink targets and the graph', async () => {
      expect(await tags.list()).toEqual([{ name: 'work', count: 1 }])
      expect((await todos.list()).tasks.map((t) => t.content)).toEqual(['ship it'])
      expect(await links.getWikilinkTargets()).toEqual({ targets: ['Shopping'] })

      const g = await graph.get()
      expect(g.nodes.map((n) => n.id).sort()).toEqual(['Project', 'Shopping'])
      expect(g.edges).toEqual([{ source: 'Project', target: 'Shopping', weight: 1 }])
    })

    it('searches the folder from memory', async () => {
      const found = await search.query('milk')
      expect(found.results.map((r) => r.pageName)).toEqual(['Shopping'])
      expect(found.status!.indexOnDisk).toBe(false)
      expect(found.status!.indexStatus).toBe('ready')
    })

    it('reports the index as in memory, never on disk', async () => {
      const status = await search.status()
      expect(status).toMatchObject({ indexStatus: 'ready', encrypted: false, indexOnDisk: false })
      expect(status.numDocs).toBe(2)
    })
  })

  describe('blocks', () => {
    beforeEach(async () => {
      open()
      await pages.update('Project', blockData(['TODO ship it', 'a detail']))
    })

    it('looks a block up by uuid, wherever it lives', async () => {
      const [first] = blockData(['TODO ship it'])
      const found = await blocks.lookup(first.uuid)
      expect(found).toEqual({
        uuid: first.uuid,
        pageName: 'Project',
        content: 'TODO ship it',
        hasChildren: false,
      })
      expect(await blocks.lookup('99999999-0000-4000-8000-000000000000')).toBeNull()
    })

    it('edits one block off-page, as the task manager does', async () => {
      const [first] = blockData(['TODO ship it'])
      const result = await blocks.update(first.uuid, {
        content: 'DONE ship it',
        properties: { priority: '1' },
        pageName: 'Project',
      })

      expect(result).toMatchObject({
        uuid: first.uuid,
        pageName: 'Project',
        content: 'DONE ship it',
        properties: { priority: '1' },
      })

      // Written through, and the task list reflects it.
      const task = (await todos.list()).tasks.find((t) => t.uuid === first.uuid)!
      expect(task.status).toBe('DONE')
      expect(task.priority).toBe('1')
    })

    it('removes a property set to null', async () => {
      const [first] = blockData(['TODO ship it'])
      await blocks.update(first.uuid, { properties: { priority: '1' } })
      await blocks.update(first.uuid, { properties: { priority: null } })

      const task = (await todos.list()).tasks.find((t) => t.uuid === first.uuid)!
      expect(task.priority).toBeNull()
    })

    it('reports a block it cannot find', async () => {
      await expect(
        blocks.update('99999999-0000-4000-8000-000000000000', { content: 'x' })
      ).rejects.toThrow(/not found/)
    })
  })

  describe('preferences and UI state', () => {
    beforeEach(() => open())

    it('keeps both in the garden folder, not on the server', async () => {
      expect(await user.getPrefs()).toEqual({})
      await user.savePrefs({ theme: 'forest' })
      expect(await user.getPrefs()).toEqual({ theme: 'forest' })

      await user.saveState({ recentSheets: ['Shopping'] })
      expect(await user.getState()).toEqual({ recentSheets: ['Shopping'] })

      expect(Object.keys(root.snapshot())).toEqual(
        expect.arrayContaining(['.tend/prefs.json', '.tend/ui-state.json'])
      )
    })
  })

  describe('stabilize', () => {
    beforeEach(() => open())

    it('writes a block footer into a file that has none, once', async () => {
      // A hand-written file: no footer, so its block UUIDs are not stable.
      root.seedFile('pages/Handwritten.md', '- a thought\n- another\n')

      const first = await stabilize.stabilizeUuids()
      expect(first.stabilized).toBe(1)
      expect(first.failed).toBe(0)
      expect(root.snapshot()['pages/Handwritten.md']).toContain('tend:blocks')

      // Already stable: a second pass rewrites nothing.
      const second = await stabilize.stabilizeUuids()
      expect(second).toMatchObject({ stabilized: 0, alreadyStable: 1, failed: 0 })
    })
  })

  describe('an encrypted garden', () => {
    it('serves everything while unlocked and nothing while locked', async () => {
      const { loadWasm } = await import('../wasm')
      const wasm = await loadWasm()
      root = FakeDirectoryHandle.create()
      const store = new LocalFolderStore(root.asHandle())
      const identity = wasm.generate_identity()

      setLocalSession({ id: 'secrets', store, encrypted: true, identity })
      await pages.create('Shopping', 'SECRETBODY')
      await user.saveState({ recentSheets: ['SECRETTITLE'] })

      expect((await pages.get('Shopping')).name).toBe('Shopping')
      expect((await search.status()).encrypted).toBe(true)

      // Nothing of it is readable in the folder.
      const onDisk = Object.values(root.snapshot()).join('\n')
      expect(onDisk).not.toContain('SECRETBODY')
      expect(onDisk).not.toContain('SECRETTITLE')

      // Locked: the listing still works (filenames only), the content does not.
      setLocalSession({ id: 'secrets', store, encrypted: true })
      await expect(pages.get('Shopping')).rejects.toThrow(/locked/)
      await expect(user.getState()).rejects.toThrow(/locked/)
    })
  })

  describe('switching gardens', () => {
    it('drops everything derived from the one before', async () => {
      open()
      await pages.create('Shopping', 'milk')
      expect((await pages.list()).map((m) => m.name)).toEqual(['Shopping'])

      // A different folder, opened as a different garden.
      open()
      expect(await pages.list()).toEqual([])
      expect(await tags.list()).toEqual([])
      expect(await contentTypes.list()).toEqual(BUILT_IN_CONTENT_TYPES)
    })
  })
})

describe.skipIf(built)('local backend', () => {
  it.skip('not built — run `make wasm` to include these checks', () => {})
})
