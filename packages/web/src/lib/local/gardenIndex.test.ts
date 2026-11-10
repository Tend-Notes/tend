// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// The derived views a local garden builds for itself.
//
// These check the bookkeeping — the counts, the maps, the orderings — against a
// small garden written through the real layer below. What a tag or a task or a
// link IS stays the bridge's business and is tested there; what matters here is
// that nothing is double-counted, nothing is missed, and a link resolves
// case-insensitively the way the server's index does.

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { FakeDirectoryHandle } from './handleFake'
import { LocalFolderStore } from './LocalFolderStore'
import { BUILT_IN_CONTENT_TYPES, writeSheet, type GardenSession } from './gardenFiles'
import { backlinksOf, buildIndex, searchIndex, type GardenIndex } from './gardenIndex'
import type { ContentType } from '../api'
import type { Block, Page } from '../../types'

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

let nextUuid = 0
function uuid(): string {
  nextUuid += 1
  return `${String(nextUuid).padStart(8, '0')}-0000-4000-8000-000000000000`
}

/** A page of flat blocks, one per line of content. */
function pageOf(name: string, contents: string[], over: Partial<Page> = {}): Page {
  const blocks: Record<string, Block> = {}
  const rootBlocks: string[] = []
  for (const content of contents) {
    const id = uuid()
    rootBlocks.push(id)
    blocks[id] = {
      uuid: id,
      content,
      parentUuid: null,
      children: [],
      collapsed: false,
      properties: {},
      depth: 0,
    }
  }
  return {
    name,
    title: name,
    rootBlocks,
    blocks,
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

describe.skipIf(!built)('garden index', () => {
  beforeAll(async () => {
    const { loadWasm } = await import('../wasm')
    await loadWasm(readFileSync(wasmPath))
  })

  function session(): { root: FakeDirectoryHandle; session: GardenSession } {
    const root = FakeDirectoryHandle.create()
    return {
      root,
      session: { id: 'notes', store: new LocalFolderStore(root.asHandle()), encrypted: false },
    }
  }

  /** A garden with two pages, a journal and a dated meeting. */
  async function sampleGarden() {
    const { session: s } = session()
    const types = [...BUILT_IN_CONTENT_TYPES, MEETING_TYPE]

    await writeSheet(
      s,
      PAGE_TYPE,
      pageOf('Project', ['TODO ship it', 'see [[Shopping]] and [[Shopping]] again', 'about #Work'])
    )
    await writeSheet(s, PAGE_TYPE, pageOf('Shopping', ['milk', 'DONE oat milk', 'also #work']))
    await writeSheet(
      s,
      JOURNAL_TYPE,
      pageOf('2026-10-29', ['met about [[project]]'], {
        contentType: 'journal',
        isJournal: true,
        journalDate: '2026-10-29',
      })
    )
    await writeSheet(
      s,
      MEETING_TYPE,
      pageOf('meetings/2026-10-01/Standup', ['TODO write the notes'], {
        contentType: 'meeting',
        title: 'Standup',
        journalDate: '2026-10-01',
      }),
      '2026-10-01'
    )

    return { session: s, types, index: await buildIndex(s, types) }
  }

  let garden: { session: GardenSession; types: ContentType[]; index: GardenIndex }
  beforeAll(async () => {
    garden = await sampleGarden()
  })

  describe('the scan', () => {
    it('finds every sheet, keyed by its canonical name', async () => {
      expect([...garden.index.sheets.keys()].sort()).toEqual([
        '2026-10-29',
        'Project',
        'Shopping',
        'meetings/2026-10-01/Standup',
      ])
    })

    it('lists each content type separately', async () => {
      expect(garden.index.listings.get('page')!.map((m) => m.name).sort()).toEqual([
        'Project',
        'Shopping',
      ])
      expect(garden.index.listings.get('journal')!.map((m) => m.name)).toEqual(['2026-10-29'])
      expect(garden.index.listings.get('meeting')!.map((m) => m.name)).toEqual([
        'meetings/2026-10-01/Standup',
      ])
    })

    it('counts a sheet’s blocks in its metadata', async () => {
      const project = garden.index.listings.get('page')!.find((m) => m.name === 'Project')!
      expect(project.blockCount).toBe(3)
    })

    it('titles a journal the way the sidebar shows it', async () => {
      expect(garden.index.listings.get('journal')![0].title).toBe('Thursday, October 29, 2026')
    })

    it('skips a file it cannot parse rather than failing the scan', async () => {
      const { session: s } = session()
      await writeSheet(s, PAGE_TYPE, pageOf('Good', ['fine']))
      // A file whose bytes are not a sheet at all.
      await s.store.write('pages/Broken.md', new Uint8Array([0xff, 0xfe, 0x00]))

      const index = await buildIndex(s, BUILT_IN_CONTENT_TYPES)
      expect([...index.sheets.keys()]).toContain('Good')
    })

    it('is empty for an empty folder', async () => {
      const { session: s } = session()
      const index = await buildIndex(s, BUILT_IN_CONTENT_TYPES)
      expect(index.sheets.size).toBe(0)
      expect(index.tags).toEqual([])
      expect(index.tasks).toEqual([])
      expect(index.graph.nodes).toEqual([])
      expect(index.wikilinkTargets).toEqual([])
    })
  })

  describe('tags', () => {
    it('counts one tag once, however it is capitalized', async () => {
      // "#Work" and "#work" are the same tag in different pages.
      expect(garden.index.tags).toEqual([{ name: 'work', count: 2 }])
    })

    it('orders by count, then by name', async () => {
      const { session: s } = session()
      await writeSheet(s, PAGE_TYPE, pageOf('A', ['#zebra', '#apple', '#apple']))
      const index = await buildIndex(s, BUILT_IN_CONTENT_TYPES)
      expect(index.tags).toEqual([
        { name: 'apple', count: 2 },
        { name: 'zebra', count: 1 },
      ])
    })
  })

  describe('tasks', () => {
    it('collects every task in the garden with its page', async () => {
      const byContent = new Map(garden.index.tasks.map((t) => [t.content, t]))
      expect([...byContent.keys()].sort()).toEqual(['oat milk', 'ship it', 'write the notes'])

      expect(byContent.get('ship it')!.status).toBe('TODO')
      expect(byContent.get('ship it')!.pageName).toBe('Project')
      expect(byContent.get('oat milk')!.status).toBe('DONE')
      expect(byContent.get('write the notes')!.contentType).toBe('meeting')
    })

    it('dates a task by the sheet it is filed under', async () => {
      const task = garden.index.tasks.find((t) => t.content === 'write the notes')!
      expect(task.journalDate).toBe('2026-10-01')
    })
  })

  describe('backlinks', () => {
    it('finds a link whose case differs from its target', async () => {
      // The journal writes [[project]]; the page is "Project".
      const refs = backlinksOf(garden.index, 'Project')
      expect(refs.map((r) => r.pageName)).toContain('2026-10-29')
      expect(refs.find((r) => r.pageName === '2026-10-29')!.blockContent).toBe(
        'met about [[project]]'
      )
    })

    it('reports each linking block, including two links in one block', async () => {
      // "see [[Shopping]] and [[Shopping]] again" is one block, two links.
      const refs = backlinksOf(garden.index, 'Shopping')
      expect(refs).toHaveLength(2)
      expect(new Set(refs.map((r) => r.blockUuid)).size).toBe(1)
    })

    it('answers a tag page with the blocks that mention the tag', async () => {
      const refs = backlinksOf(garden.index, 'tags/work')
      expect(refs.map((r) => r.pageName).sort()).toEqual(['Project', 'Shopping'])
    })

    it('says a page nothing links to has no backlinks', async () => {
      expect(backlinksOf(garden.index, 'Nothing')).toEqual([])
    })

    it('carries the journal flag through, for the sidebar grouping', async () => {
      const refs = backlinksOf(garden.index, 'Project')
      const fromJournal = refs.find((r) => r.pageName === '2026-10-29')!
      expect(fromJournal.isJournal).toBe(true)
      expect(fromJournal.journalDate).toBe('2026-10-29')
    })
  })

  describe('wikilink targets', () => {
    it('lists every target written, as written', async () => {
      // Both spellings appear: the autocomplete offers what people typed.
      expect([...garden.index.wikilinkTargets].sort()).toEqual(['Shopping', 'project'])
    })

    it('includes a target that has no page yet', async () => {
      const { session: s } = session()
      await writeSheet(s, PAGE_TYPE, pageOf('A', ['see [[Not Written Yet]]']))
      const index = await buildIndex(s, BUILT_IN_CONTENT_TYPES)
      expect(index.wikilinkTargets).toEqual(['Not Written Yet'])
    })

    it('leaves tags out', async () => {
      const { session: s } = session()
      await writeSheet(s, PAGE_TYPE, pageOf('A', ['#atag']))
      const index = await buildIndex(s, BUILT_IN_CONTENT_TYPES)
      expect(index.wikilinkTargets).toEqual([])
    })
  })

  describe('the graph', () => {
    it('has a node per sheet, labelled as the sidebar labels it', async () => {
      expect(garden.index.graph.nodes.map((n) => n.id).sort()).toEqual([
        '2026-10-29',
        'Project',
        'Shopping',
        'meetings/2026-10-01/Standup',
      ])
      const journal = garden.index.graph.nodes.find((n) => n.id === '2026-10-29')!
      expect(journal.label).toBe('Thursday, October 29, 2026')
      expect(journal.contentType).toBe('journal')
    })

    it('weighs an edge by how many links it stands for', async () => {
      const edge = garden.index.graph.edges.find(
        (e) => e.source === 'Project' && e.target === 'Shopping'
      )!
      expect(edge.weight).toBe(2)
    })

    it('resolves an edge whose link case differs from the target', async () => {
      expect(
        garden.index.graph.edges.find((e) => e.source === '2026-10-29' && e.target === 'Project')
      ).toBeDefined()
    })

    it('leaves out a link to a page that does not exist', async () => {
      const { session: s } = session()
      await writeSheet(s, PAGE_TYPE, pageOf('A', ['see [[Nowhere]]']))
      const index = await buildIndex(s, BUILT_IN_CONTENT_TYPES)
      expect(index.graph.nodes.map((n) => n.id)).toEqual(['A'])
      expect(index.graph.edges).toEqual([])
    })

    it('names only the content types actually present, for the legend', async () => {
      expect(garden.index.graph.contentTypes.map((c) => c.id).sort()).toEqual([
        'journal',
        'meeting',
        'page',
      ])

      const { session: s } = session()
      await writeSheet(s, PAGE_TYPE, pageOf('A', ['just a page']))
      const index = await buildIndex(s, [...BUILT_IN_CONTENT_TYPES, MEETING_TYPE])
      expect(index.graph.contentTypes.map((c) => c.id)).toEqual(['page'])
    })
  })

  describe('search', () => {
    it('finds the blocks that contain the query, whatever the case', async () => {
      const hits = searchIndex(garden.index, 'MILK')
      expect(hits.map((h) => h.content).sort()).toEqual(['DONE oat milk', 'milk'])
      expect(hits[0].pageName).toBe('Shopping')
    })

    it('ranks a whole-block match above a mention inside a longer block', async () => {
      const hits = searchIndex(garden.index, 'milk')
      expect(hits[0].content).toBe('milk')
    })

    it('respects the limit, and says nothing for an empty query', async () => {
      expect(searchIndex(garden.index, 'milk', 1)).toHaveLength(1)
      expect(searchIndex(garden.index, '   ')).toEqual([])
      expect(searchIndex(garden.index, 'milk', 0)).toEqual([])
    })

    it('finds nothing for a query no block contains', async () => {
      expect(searchIndex(garden.index, 'xyzzy')).toEqual([])
    })
  })

  describe('an encrypted garden', () => {
    it('derives everything from decrypted content held only in memory', async () => {
      const { loadWasm } = await import('../wasm')
      const wasm = await loadWasm()
      const root = FakeDirectoryHandle.create()
      const s: GardenSession = {
        id: 'secrets',
        store: new LocalFolderStore(root.asHandle()),
        encrypted: true,
        identity: wasm.generate_identity(),
      }

      await writeSheet(s, PAGE_TYPE, pageOf('Project', ['TODO ship it', 'about #Work']))
      const index = await buildIndex(s, BUILT_IN_CONTENT_TYPES)

      expect(index.tags).toEqual([{ name: 'work', count: 1 }])
      expect(index.tasks.map((t) => t.content)).toEqual(['ship it'])
      expect(searchIndex(index, 'ship')).toHaveLength(1)

      // And none of it reached the folder.
      const onDisk = Object.values(root.snapshot()).join('\n')
      expect(onDisk).not.toContain('ship it')
      expect(onDisk).not.toContain('Work')
    })

    it('cannot be scanned while locked', async () => {
      const { loadWasm } = await import('../wasm')
      const wasm = await loadWasm()
      const root = FakeDirectoryHandle.create()
      const identity = wasm.generate_identity()
      const store = new LocalFolderStore(root.asHandle())

      await writeSheet(
        { id: 'secrets', store, encrypted: true, identity },
        PAGE_TYPE,
        pageOf('Project', ['secret'])
      )

      // Locked: the sheet is unreadable, so the scan finds nothing rather than
      // returning a garden with the content missing silently from some views.
      const index = await buildIndex({ id: 'secrets', store, encrypted: true }, BUILT_IN_CONTENT_TYPES)
      expect(index.sheets.size).toBe(0)
    })
  })
})

describe.skipIf(built)('garden index', () => {
  it.skip('not built — run `make wasm` to include these checks', () => {})
})
