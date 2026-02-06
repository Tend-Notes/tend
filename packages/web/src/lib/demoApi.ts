// SPDX-License-Identifier: MIT WITH Commons-Clause
// Demo mode API layer - mirrors api.ts but uses IndexedDB storage

import type {
  Page,
  PageMeta,
  BacklinkRef,
  Graph,
  GraphNode,
  GraphEdge,
  Block,
  BlockRef,
  CreateSheetResponse,
} from '../types'

import * as demoStore from './demoStore'
import { v4 as uuidv4 } from 'uuid'

// Re-export types that don't change
export { VersionConflictError } from './api'

// ============================================================================
// Block data format for API requests (matches api.ts)
// ============================================================================

interface BlockData {
  uuid: string
  content: string
  parent_uuid: string | null
  children: string[]
  collapsed: boolean
  properties: Record<string, string>
}

// Convert frontend Block to API format
export function blockToApiFormat(block: Block): BlockData {
  return {
    uuid: block.uuid,
    content: block.content,
    parent_uuid: block.parentUuid,
    children: block.children,
    collapsed: block.collapsed,
    properties: block.properties,
  }
}

// Convert Page blocks to API format
export function pageBlocksToApiFormat(page: Page): BlockData[] {
  return Object.values(page.blocks).map(blockToApiFormat)
}

// Convert BlockData array back to Page.blocks format
function blocksDataToPageBlocks(blocksData: BlockData[]): Record<string, Block> {
  const blocks: Record<string, Block> = {}
  for (const bd of blocksData) {
    blocks[bd.uuid] = {
      uuid: bd.uuid,
      content: bd.content,
      parentUuid: bd.parent_uuid,
      children: bd.children,
      collapsed: bd.collapsed,
      properties: bd.properties,
      depth: 0, // Will be computed
    }
  }
  // Compute depths
  for (const block of Object.values(blocks)) {
    let depth = 0
    let current = block
    while (current.parentUuid && blocks[current.parentUuid]) {
      depth++
      current = blocks[current.parentUuid]
    }
    block.depth = depth
  }
  return blocks
}

// ============================================================================
// Pages API
// ============================================================================

export const pages = {
  list: async (): Promise<PageMeta[]> => {
    return demoStore.listPages()
  },

  get: async (name: string): Promise<Page> => {
    const page = await demoStore.getPage(name)
    if (!page) {
      throw new Error(`404: Page not found: ${name}`)
    }
    return page
  },

  create: async (name: string, content?: string): Promise<Page> => {
    const existing = await demoStore.getPage(name)
    if (existing) {
      throw new Error(`409: Page already exists: ${name}`)
    }

    const now = new Date().toISOString()
    const blockUuid = uuidv4()
    const page: Page = {
      name,
      title: name,
      rootBlocks: [blockUuid],
      blocks: {
        [blockUuid]: {
          uuid: blockUuid,
          content: content || '',
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
      createdAt: now,
      modifiedAt: now,
      version: 1,
    }

    await demoStore.savePage(page)
    return page
  },

  update: async (name: string, blocksData: BlockData[], version?: number): Promise<Page> => {
    const existing = await demoStore.getPage(name)
    if (!existing) {
      throw new Error(`404: Page not found: ${name}`)
    }

    // Simple version check (no real conflict resolution in demo)
    if (version !== undefined && version !== existing.version) {
      throw new Error(`409: Version conflict`)
    }

    const blocks = blocksDataToPageBlocks(blocksData)
    const rootBlocks = blocksData
      .filter((b) => b.parent_uuid === null)
      .map((b) => b.uuid)

    const updated: Page = {
      ...existing,
      blocks,
      rootBlocks,
      modifiedAt: new Date().toISOString(),
      version: existing.version + 1,
    }

    await demoStore.savePage(updated)
    return updated
  },

  delete: async (name: string): Promise<{ deleted: string }> => {
    await demoStore.deletePage(name)
    return { deleted: name }
  },

  getBacklinks: async (name: string): Promise<BacklinkRef[]> => {
    const sheets = await demoStore.getAllSheets()
    const backlinks: BacklinkRef[] = []

    for (const sheet of sheets) {
      if (sheet.name === name) continue

      for (const block of Object.values(sheet.blocks)) {
        // Check for wikilinks to this page
        const wikilinkPattern = /\[\[([^\]]+)\]\]/g
        let match
        while ((match = wikilinkPattern.exec(block.content)) !== null) {
          const target = match[1]
          if (target === name || target.toLowerCase() === name.toLowerCase()) {
            backlinks.push({
              pageName: sheet.name,
              pageTitle: sheet.title,
              blockUuid: block.uuid,
              blockContent: block.content,
              isJournal: sheet.isJournal,
              journalDate: sheet.journalDate,
            })
          }
        }
      }
    }

    return backlinks
  },
}

// ============================================================================
// Journals API
// ============================================================================

export const journals = {
  list: async (): Promise<PageMeta[]> => {
    return demoStore.listJournals()
  },

  get: async (date: string): Promise<Page> => {
    const journal = await demoStore.getJournal(date)
    if (!journal) {
      // Create a new journal for this date
      const now = new Date().toISOString()
      const blockUuid = uuidv4()
      const newJournal: Page = {
        name: date,
        title: formatJournalTitle(date),
        rootBlocks: [blockUuid],
        blocks: {
          [blockUuid]: {
            uuid: blockUuid,
            content: '',
            parentUuid: null,
            children: [],
            collapsed: false,
            properties: {},
            depth: 0,
          },
        },
        properties: {},
        contentType: 'journal',
        isJournal: true,
        journalDate: date,
        createdAt: now,
        modifiedAt: now,
        version: 1,
      }
      await demoStore.saveJournal(newJournal)
      return newJournal
    }
    return journal
  },

  update: async (date: string, blocksData: BlockData[], version?: number): Promise<Page> => {
    let existing = await demoStore.getJournal(date)

    if (!existing) {
      // Create if doesn't exist
      existing = await journals.get(date)
    }

    if (version !== undefined && version !== existing.version) {
      throw new Error(`409: Version conflict`)
    }

    const blocks = blocksDataToPageBlocks(blocksData)
    const rootBlocks = blocksData
      .filter((b) => b.parent_uuid === null)
      .map((b) => b.uuid)

    const updated: Page = {
      ...existing,
      blocks,
      rootBlocks,
      modifiedAt: new Date().toISOString(),
      version: existing.version + 1,
    }

    await demoStore.saveJournal(updated)
    return updated
  },
}

// Format journal date as title
function formatJournalTitle(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// ============================================================================
// Search API (disabled in demo mode)
// ============================================================================

export interface SearchStatus {
  disabled: boolean
  rebuilding: boolean
  message?: string
}

export interface SearchResponse {
  results: never[]
  status: SearchStatus
}

export const search = {
  query: async (_q: string, _limit = 20): Promise<SearchResponse> => {
    return {
      results: [],
      status: {
        disabled: true,
        rebuilding: false,
        message: 'Search is disabled in demo mode',
      },
    }
  },
}

// ============================================================================
// Links API
// ============================================================================

export interface WikilinkTargetsResponse {
  targets: string[]
}

export const links = {
  getWikilinkTargets: async (): Promise<WikilinkTargetsResponse> => {
    const sheets = await demoStore.getAllSheets()
    const targetsSet = new Set<string>()

    for (const sheet of sheets) {
      for (const block of Object.values(sheet.blocks)) {
        const wikilinkPattern = /\[\[([^\]]+)\]\]/g
        let match
        while ((match = wikilinkPattern.exec(block.content)) !== null) {
          targetsSet.add(match[1])
        }
      }
    }

    return { targets: Array.from(targetsSet) }
  },
}

// ============================================================================
// Graph API
// ============================================================================

export const graph = {
  get: async (): Promise<Graph> => {
    const sheets = await demoStore.getAllSheets()
    const nodes: GraphNode[] = []
    const edgesMap = new Map<string, GraphEdge>()
    const contentTypesSet = new Set<string>()

    // Create nodes
    for (const sheet of sheets) {
      nodes.push({
        id: sheet.name,
        label: sheet.title,
        contentType: sheet.contentType,
        blockCount: Object.keys(sheet.blocks).length,
      })
      contentTypesSet.add(sheet.contentType)
    }

    // Create edges from wikilinks
    for (const sheet of sheets) {
      for (const block of Object.values(sheet.blocks)) {
        const wikilinkPattern = /\[\[([^\]]+)\]\]/g
        let match
        while ((match = wikilinkPattern.exec(block.content)) !== null) {
          const target = match[1]
          // Check if target exists
          const targetSheet = sheets.find(
            (s) => s.name === target || s.name.toLowerCase() === target.toLowerCase()
          )
          if (targetSheet) {
            const edgeKey = `${sheet.name}:${targetSheet.name}`
            const existing = edgesMap.get(edgeKey)
            if (existing) {
              existing.weight++
            } else {
              edgesMap.set(edgeKey, {
                source: sheet.name,
                target: targetSheet.name,
                weight: 1,
              })
            }
          }
        }
      }
    }

    // Content types for legend
    const contentTypes = Array.from(contentTypesSet).map((id) => ({
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
    }))

    return {
      nodes,
      edges: Array.from(edgesMap.values()),
      contentTypes,
    }
  },
}

// ============================================================================
// Tags API
// ============================================================================

export interface TagInfo {
  name: string
  count: number
}

export const tags = {
  list: async (): Promise<TagInfo[]> => {
    const sheets = await demoStore.getAllSheets()
    const tagCounts = new Map<string, number>()

    for (const sheet of sheets) {
      for (const block of Object.values(sheet.blocks)) {
        // Match #tag patterns (not inside wikilinks)
        const tagPattern = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_-]*)/g
        let match
        while ((match = tagPattern.exec(block.content)) !== null) {
          const tag = match[1]
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)
        }
      }
    }

    return Array.from(tagCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  },
}

// ============================================================================
// Todos API
// ============================================================================

export interface TaskItem {
  uuid: string
  status: string
  content: string
  pageName: string
  pageTitle: string
  isJournal: boolean
  journalDate: string | null
  dueDate: string | null
  startDate: string | null
  priority: string | null
}

export interface TaskList {
  tasks: TaskItem[]
}

export const todos = {
  list: async (): Promise<TaskList> => {
    const sheets = await demoStore.getAllSheets()
    const tasks: TaskItem[] = []

    // Task status patterns
    const statusPattern = /^(TODO|DOING|DONE|NOW|LATER|NEVER)\s/

    for (const sheet of sheets) {
      for (const block of Object.values(sheet.blocks)) {
        const match = statusPattern.exec(block.content)
        if (match) {
          tasks.push({
            uuid: block.uuid,
            status: match[1],
            content: block.content.slice(match[0].length),
            pageName: sheet.name,
            pageTitle: sheet.title,
            isJournal: sheet.isJournal,
            journalDate: sheet.journalDate,
            dueDate: null, // TODO: parse from content if needed
            startDate: null,
            priority: null,
          })
        }
      }
    }

    return { tasks }
  },
}

// ============================================================================
// Git API (all no-op in demo mode)
// ============================================================================

export const git = {
  status: async () => ({
    isRepo: false,
    hasChanges: false,
    branch: null,
    remote: null,
    hasUpstream: false,
    ahead: 0,
    behind: 0,
    changedFiles: [],
  }),

  backup: async () => ({
    success: false,
    commitSha: null,
    message: 'Git backup is not available in demo mode',
    timestamp: new Date().toISOString(),
  }),

  commit: async (_message?: string) => ({
    success: false,
    commitSha: null,
    message: 'Git commit is not available in demo mode',
    timestamp: new Date().toISOString(),
  }),

  history: async (_limit = 50, _path?: string) => [],

  diff: async (_commitSha: string, _path?: string) => ({
    sha: '',
    message: '',
    timestamp: new Date().toISOString(),
    files: [],
  }),

  restore: async (_commitSha: string, _path?: string) => ({
    success: false,
    commitSha: null,
    message: 'Git restore is not available in demo mode',
    timestamp: new Date().toISOString(),
  }),

  push: async () => ({
    success: false,
    message: 'Git push is not available in demo mode',
    details: '',
  }),

  pull: async () => ({
    success: false,
    message: 'Git pull is not available in demo mode',
    details: '',
  }),

  setRemote: async (_url: string) => ({
    success: false,
    url: '',
    message: 'Git remote is not available in demo mode',
    verified: false,
  }),

  removeRemote: async () => {},

  testRemote: async () => ({
    success: false,
    url: '',
    message: 'Git remote is not available in demo mode',
    verified: false,
  }),

  checkRemoteGarden: async () => ({
    found: false,
    name: null,
  }),

  importRemoteGarden: async () => ({
    success: false,
    message: 'Git import is not available in demo mode',
    filesChanged: 0,
  }),
}

// ============================================================================
// Gardens API (single fixed garden in demo mode)
// ============================================================================

export interface Garden {
  id: string
  name: string
  path: string
  encrypted?: boolean
  searchEnabled?: boolean
  indexTtlHours?: number
}

export interface GardensResponse {
  gardens: Garden[]
  active: string
  archived?: never[]
}

const DEMO_GARDEN: Garden = {
  id: 'demo',
  name: 'Demo Garden',
  path: 'demo',
  encrypted: false,
  searchEnabled: false,
}

export const gardens = {
  list: async (): Promise<GardensResponse> => ({
    gardens: [DEMO_GARDEN],
    active: 'demo',
    archived: [],
  }),

  create: async () => {
    throw new Error('Creating gardens is not available in demo mode')
  },

  archive: async () => {
    throw new Error('Archiving gardens is not available in demo mode')
  },

  restore: async () => {
    throw new Error('Restoring gardens is not available in demo mode')
  },

  deletePermanent: async () => {
    throw new Error('Deleting gardens is not available in demo mode')
  },

  switch: async () => ({
    active: 'demo',
    message: 'Demo mode only has one garden',
    unlock_required: false,
  }),

  unlock: async () => ({
    active: 'demo',
    message: 'Demo mode garden is not encrypted',
  }),

  rename: async () => DEMO_GARDEN,
}

// ============================================================================
// Templates API
// ============================================================================

export const templates = {
  get: async (contentTypeId: string): Promise<Page> => {
    // Return empty template
    const now = new Date().toISOString()
    const blockUuid = uuidv4()
    return {
      name: `_template_${contentTypeId}`,
      title: `${contentTypeId} Template`,
      rootBlocks: [blockUuid],
      blocks: {
        [blockUuid]: {
          uuid: blockUuid,
          content: '',
          parentUuid: null,
          children: [],
          collapsed: false,
          properties: {},
          depth: 0,
        },
      },
      properties: {},
      contentType: contentTypeId,
      isJournal: false,
      journalDate: null,
      createdAt: now,
      modifiedAt: now,
      version: 1,
    }
  },

  update: async (contentTypeId: string, _blocks: BlockData[]): Promise<Page> => {
    // Templates are not persisted in demo mode
    return templates.get(contentTypeId)
  },
}

// ============================================================================
// Content Types API
// ============================================================================

export interface ContentType {
  id: string
  name: string
  directory: string
  saveByDate: boolean
  template: string
}

const DEFAULT_CONTENT_TYPES: ContentType[] = [
  { id: 'page', name: 'Pages', directory: 'pages', saveByDate: false, template: '' },
  { id: 'journal', name: 'Journals', directory: 'journals', saveByDate: true, template: '' },
]

export const contentTypes = {
  list: async (): Promise<ContentType[]> => DEFAULT_CONTENT_TYPES,

  update: async (types: ContentType[]): Promise<ContentType[]> => {
    // Content types are not persisted in demo mode
    return types
  },
}

// ============================================================================
// Sheets API (routes to pages/journals)
// ============================================================================

export const sheets = {
  list: async (contentTypeId: string): Promise<PageMeta[]> => {
    if (contentTypeId === 'journal') {
      return journals.list()
    }
    return pages.list()
  },

  get: async (contentTypeId: string, name: string, date?: string): Promise<Page> => {
    if (contentTypeId === 'journal' && date) {
      return journals.get(date)
    }
    return pages.get(name)
  },

  create: async (
    contentTypeId: string,
    name: string,
    options?: { date?: string; content?: string }
  ): Promise<CreateSheetResponse> => {
    if (contentTypeId === 'journal' && options?.date) {
      return journals.get(options.date)
    }
    return pages.create(name, options?.content)
  },

  update: async (
    contentTypeId: string,
    name: string,
    blocksData: BlockData[],
    version?: number,
    date?: string
  ): Promise<Page> => {
    if (contentTypeId === 'journal' && date) {
      return journals.update(date, blocksData, version)
    }
    return pages.update(name, blocksData, version)
  },

  delete: async (
    contentTypeId: string,
    name: string,
    date?: string
  ): Promise<{ deleted: string; contentType: string }> => {
    if (contentTypeId === 'journal' && date) {
      await demoStore.deleteJournal(date)
      return { deleted: date, contentType: 'journal' }
    }
    await demoStore.deletePage(name)
    return { deleted: name, contentType: contentTypeId }
  },
}

// ============================================================================
// Identity API
// ============================================================================

export interface WhoamiResponse {
  username: string
}

export const identity = {
  whoami: async (): Promise<WhoamiResponse> => ({
    username: 'demo',
  }),
}

// ============================================================================
// User preferences and state API
// ============================================================================

export const user = {
  getPrefs: async (): Promise<Record<string, unknown>> => {
    return demoStore.getPrefs()
  },

  savePrefs: async (prefs: Record<string, unknown>): Promise<void> => {
    await demoStore.savePrefs(prefs)
  },

  getState: async (): Promise<Record<string, unknown>> => {
    return demoStore.getState()
  },

  saveState: async (state: Record<string, unknown>): Promise<void> => {
    await demoStore.saveState(state)
  },
}

// ============================================================================
// Blocks API (for block references)
// ============================================================================

export const blocks = {
  lookup: async (uuid: string): Promise<BlockRef | null> => {
    const result = await demoStore.findBlockByUuid(uuid)
    if (!result) return null

    const { page, block } = result
    return {
      uuid: block.uuid,
      pageName: page.name,
      content: block.content,
      hasChildren: block.children.length > 0,
    }
  },
}

// ============================================================================
// Import API (disabled in demo mode)
// ============================================================================

export const importApi = {
  logseq: async () => {
    throw new Error('Import is not available in demo mode')
  },

  uploadLogseqZip: async () => {
    throw new Error('Import is not available in demo mode')
  },

  errors: {
    list: async () => ({ errors: [] }),
    get: async () => {
      throw new Error('Import errors not available in demo mode')
    },
    delete: async () => ({ deleted: '' }),
    deleteAll: async () => ({ deleted: 0 }),
    accept: async () => {
      throw new Error('Import errors not available in demo mode')
    },
  },
}

// ============================================================================
// Reindex API (no-op in demo mode)
// ============================================================================

export const reindex = {
  rebuildAll: async () => ({
    pagesIndexed: 0,
    journalsIndexed: 0,
    linkEntries: 0,
    blockCount: null,
    searchDocs: null,
    message: 'Reindex is not available in demo mode',
  }),
}

// ============================================================================
// Stabilize API (no-op in demo mode)
// ============================================================================

export const stabilize = {
  stabilizeUuids: async () => ({
    stabilized: 0,
    alreadyStable: 0,
    failed: 0,
    message: 'Stabilize is not available in demo mode',
  }),
}
