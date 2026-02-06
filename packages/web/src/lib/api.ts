// SPDX-License-Identifier: MIT WITH Commons-Clause
// API client for Tend backend
//
// In demo mode (VITE_DEMO_MODE=true), all API calls are proxied to demoApi.ts
// which uses IndexedDB instead of the backend server.

import type {
  Page,
  PageMeta,
  SearchResult,
  BacklinkRef,
  Graph,
  GitStatus,
  BackupResult,
  CommitInfo,
  CommitDiff,
  Block,
  PushResult,
  RemoteResult,
  GitImportResult,
  RemoteGardenInfo,
  CreateSheetResponse,
  BlockRef,
} from '../types'

// Demo mode detection
export const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true'

// Import demo API for proxying (tree-shaken in non-demo builds)
import * as demoApi from './demoApi'

const API_BASE = '/api/v1'

/**
 * Error thrown when a version conflict occurs (409 Conflict).
 * This happens when another client has modified the resource since we last loaded it.
 */
export class VersionConflictError extends Error {
  readonly currentVersion: number

  constructor(message: string, currentVersion: number) {
    super(message)
    this.name = 'VersionConflictError'
    this.currentVersion = currentVersion
  }
}

// Helper for JSON requests
async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }))

    // Handle 409 Conflict specially
    if (res.status === 409 && error.code === 'VERSION_CONFLICT') {
      throw new VersionConflictError(error.error, error.currentVersion)
    }

    throw new Error(`${res.status}: ${error.error || 'Request failed'}`)
  }

  return res.json()
}

// Block data format for API requests
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

// ============================================================================
// Pages API
// ============================================================================

const _pages = {
  list: () => fetchJson<PageMeta[]>(`${API_BASE}/pages`),

  get: (name: string) => fetchJson<Page>(`${API_BASE}/pages/${encodeURIComponent(name)}`),

  create: (name: string, content?: string) =>
    fetchJson<Page>(`${API_BASE}/pages`, {
      method: 'POST',
      body: JSON.stringify({ name, content }),
    }),

  update: (name: string, blocks: BlockData[], version?: number) =>
    fetchJson<Page>(`${API_BASE}/pages/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ blocks, version }),
    }),

  delete: (name: string) =>
    fetchJson<{ deleted: string }>(`${API_BASE}/pages/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),

  getBacklinks: (name: string) =>
    fetchJson<BacklinkRef[]>(`${API_BASE}/pages/${encodeURIComponent(name)}/backlinks`),
}

export const pages = isDemoMode ? demoApi.pages : _pages

// ============================================================================
// Journals API
// ============================================================================

const _journals = {
  list: () => fetchJson<PageMeta[]>(`${API_BASE}/journals`),

  get: (date: string) => fetchJson<Page>(`${API_BASE}/journals/${date}`),

  update: (date: string, blocks: BlockData[], version?: number) =>
    fetchJson<Page>(`${API_BASE}/journals/${date}`, {
      method: 'PUT',
      body: JSON.stringify({ blocks, version }),
    }),
}

export const journals = isDemoMode ? demoApi.journals : _journals

// ============================================================================
// Search API
// ============================================================================

/** Search status for encrypted gardens */
export interface SearchStatus {
  disabled: boolean
  rebuilding: boolean
  message?: string
}

/** Search response with status information */
export interface SearchResponse {
  results: SearchResult[]
  status?: SearchStatus
}

const _search = {
  query: (q: string, limit = 20) =>
    fetchJson<SearchResponse>(`${API_BASE}/search?q=${encodeURIComponent(q)}&limit=${limit}`),
}

export const search = isDemoMode ? demoApi.search : _search

// ============================================================================
// Links API
// ============================================================================

export interface WikilinkTargetsResponse {
  targets: string[]
}

const _links = {
  /** Get all unique wikilink targets (pages referenced but not necessarily created) */
  getWikilinkTargets: () =>
    fetchJson<WikilinkTargetsResponse>(`${API_BASE}/links/wikilink-targets`),
}

export const links = isDemoMode ? demoApi.links : _links

// ============================================================================
// Graph API
// ============================================================================

const _graph = {
  get: () => fetchJson<Graph>(`${API_BASE}/graph`),
}

export const graph = isDemoMode ? demoApi.graph : _graph

// ============================================================================
// Tags API
// ============================================================================

export interface TagInfo {
  name: string
  count: number
}

const _tags = {
  list: () => fetchJson<TagInfo[]>(`${API_BASE}/tags`),
}

export const tags = isDemoMode ? demoApi.tags : _tags

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

const _todos = {
  list: () => fetchJson<TaskList>(`${API_BASE}/todos`),
}

export const todos = isDemoMode ? demoApi.todos : _todos

// ============================================================================
// Git API
// ============================================================================

const _git = {
  status: () => fetchJson<GitStatus>(`${API_BASE}/git/status`),

  backup: () =>
    fetchJson<BackupResult>(`${API_BASE}/git/backup`, {
      method: 'POST',
    }),

  commit: (message?: string) =>
    fetchJson<BackupResult>(`${API_BASE}/git/commit`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  history: (limit = 50, path?: string) => {
    const params = new URLSearchParams({ limit: limit.toString() })
    if (path) params.append('path', path)
    return fetchJson<CommitInfo[]>(`${API_BASE}/git/history?${params}`)
  },

  diff: (commitSha: string, path?: string) => {
    const params = path ? `?path=${encodeURIComponent(path)}` : ''
    return fetchJson<CommitDiff>(`${API_BASE}/git/diff/${encodeURIComponent(commitSha)}${params}`)
  },

  restore: (commitSha: string, path?: string) =>
    fetchJson<BackupResult>(`${API_BASE}/git/restore`, {
      method: 'POST',
      body: JSON.stringify({ commit: commitSha, path }),
    }),

  push: () =>
    fetchJson<PushResult>(`${API_BASE}/git/push`, {
      method: 'POST',
    }),

  pull: () =>
    fetchJson<PushResult>(`${API_BASE}/git/pull`, {
      method: 'POST',
    }),

  setRemote: (url: string) =>
    fetchJson<RemoteResult>(`${API_BASE}/git/remote`, {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  removeRemote: () =>
    fetch(`${API_BASE}/git/remote`, { method: 'DELETE' }).then((res) => {
      if (!res.ok) throw new Error('Failed to remove remote')
    }),

  testRemote: () =>
    fetchJson<RemoteResult>(`${API_BASE}/git/remote/test`, {
      method: 'POST',
    }),

  checkRemoteGarden: () => fetchJson<RemoteGardenInfo>(`${API_BASE}/git/remote/check-garden`),

  importRemoteGarden: () =>
    fetchJson<GitImportResult>(`${API_BASE}/git/remote/import`, {
      method: 'POST',
    }),
}

export const git = isDemoMode ? demoApi.git : _git

// ============================================================================
// Gardens API
// ============================================================================

export interface Garden {
  id: string
  name: string
  path: string
  encrypted?: boolean
  /** Whether full-text search is enabled (may expose plaintext in .tend/) */
  searchEnabled?: boolean
  /** Hours after last use before search index is auto-deleted (0 = never) */
  indexTtlHours?: number
}

export interface ArchivedGarden {
  id: string
  name: string
  path: string
  encrypted?: boolean
  searchEnabled?: boolean
  indexTtlHours?: number
  archived_at: string  // snake_case from Rust API
}

export interface GardensResponse {
  gardens: Garden[]
  active: string
  archived?: ArchivedGarden[]
}

export interface SwitchResponse {
  active?: string
  message: string
  unlock_required?: boolean
  garden_id?: string
}

export interface CreateGardenOptions {
  name: string
  path: string
  passphrase?: string
  searchEnabled?: boolean
  indexTtlHours?: number
}

const _gardens = {
  list: () => fetchJson<GardensResponse>(`${API_BASE}/gardens`),

  create: (options: CreateGardenOptions) =>
    fetchJson<Garden>(`${API_BASE}/gardens`, {
      method: 'POST',
      body: JSON.stringify({
        name: options.name,
        path: options.path,
        passphrase: options.passphrase,
        search_enabled: options.searchEnabled,
        index_ttl_hours: options.indexTtlHours,
      }),
    }),

  archive: (id: string) =>
    fetchJson<{ archived: string; message: string }>(`${API_BASE}/gardens/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  restore: (id: string) =>
    fetchJson<Garden>(`${API_BASE}/gardens/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
    }),

  deletePermanent: (id: string) =>
    fetchJson<{ deleted: string; message: string }>(`${API_BASE}/gardens/${encodeURIComponent(id)}/permanent`, {
      method: 'DELETE',
    }),

  switch: (id: string) =>
    fetchJson<SwitchResponse>(`${API_BASE}/gardens/switch`, {
      method: 'POST',
      body: JSON.stringify({ id }),
    }),

  unlock: (id: string, passphrase: string) =>
    fetchJson<{ active: string; message: string }>(`${API_BASE}/gardens/unlock`, {
      method: 'POST',
      body: JSON.stringify({ id, passphrase }),
    }),

  rename: (name: string) =>
    fetchJson<Garden>(`${API_BASE}/gardens/rename`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
}

export const gardens = isDemoMode ? demoApi.gardens : _gardens

// ============================================================================
// Templates API
// ============================================================================

const _templates = {
  get: (contentTypeId: string) =>
    fetchJson<Page>(`${API_BASE}/templates/${encodeURIComponent(contentTypeId)}`),

  update: (contentTypeId: string, blocks: BlockData[]) =>
    fetchJson<Page>(`${API_BASE}/templates/${encodeURIComponent(contentTypeId)}`, {
      method: 'PUT',
      body: JSON.stringify({ blocks }),
    }),
}

export const templates = isDemoMode ? demoApi.templates : _templates

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

const _contentTypes = {
  list: () => fetchJson<ContentType[]>(`${API_BASE}/content-types`),

  update: (types: ContentType[]) =>
    fetchJson<ContentType[]>(`${API_BASE}/content-types`, {
      method: 'PUT',
      body: JSON.stringify({ content_types: types }),
    }),
}

export const contentTypes = isDemoMode ? demoApi.contentTypes : _contentTypes

// ============================================================================
// Sheets API
// ============================================================================

const _sheets = {
  list: (contentTypeId: string) =>
    fetchJson<PageMeta[]>(`${API_BASE}/sheets/${encodeURIComponent(contentTypeId)}`),

  get: (contentTypeId: string, name: string, date?: string) => {
    const params = date ? `?date=${encodeURIComponent(date)}` : ''
    return fetchJson<Page>(`${API_BASE}/sheets/${encodeURIComponent(contentTypeId)}/${encodeURIComponent(name)}${params}`)
  },

  create: (contentTypeId: string, name: string, options?: { date?: string; content?: string }) =>
    fetchJson<CreateSheetResponse>(`${API_BASE}/sheets/${encodeURIComponent(contentTypeId)}`, {
      method: 'POST',
      body: JSON.stringify({ name, date: options?.date, content: options?.content }),
    }),

  update: (contentTypeId: string, name: string, blocks: BlockData[], version?: number, date?: string) => {
    const params = date ? `?date=${encodeURIComponent(date)}` : ''
    return fetchJson<Page>(`${API_BASE}/sheets/${encodeURIComponent(contentTypeId)}/${encodeURIComponent(name)}${params}`, {
      method: 'PUT',
      body: JSON.stringify({ blocks, version }),
    })
  },

  delete: (contentTypeId: string, name: string, date?: string) => {
    const params = date ? `?date=${encodeURIComponent(date)}` : ''
    return fetchJson<{ deleted: string; contentType: string }>(`${API_BASE}/sheets/${encodeURIComponent(contentTypeId)}/${encodeURIComponent(name)}${params}`, {
      method: 'DELETE',
    })
  },
}

export const sheets = isDemoMode ? demoApi.sheets : _sheets

// ============================================================================
// Identity API
// ============================================================================

export interface WhoamiResponse {
  username: string
}

const _identity = {
  whoami: () => fetchJson<WhoamiResponse>(`${API_BASE}/whoami`),
}

export const identity = isDemoMode ? demoApi.identity : _identity

// ============================================================================
// User API
// ============================================================================

const _user = {
  getPrefs: () => fetchJson<Record<string, unknown>>(`${API_BASE}/user/prefs`),

  savePrefs: (prefs: Record<string, unknown>) =>
    fetch(`${API_BASE}/user/prefs`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    }).then((res) => {
      if (!res.ok) throw new Error('Failed to save preferences')
    }),

  getState: () => fetchJson<Record<string, unknown>>(`${API_BASE}/user/state`),

  saveState: (state: Record<string, unknown>) =>
    fetch(`${API_BASE}/user/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    }).then((res) => {
      if (!res.ok) throw new Error('Failed to save state')
    }),
}

export const user = isDemoMode ? demoApi.user : _user

// ============================================================================
// Blocks API
// ============================================================================

const _blocks = {
  lookup: async (uuid: string): Promise<BlockRef | null> => {
    const res = await fetch(`${API_BASE}/blocks/${encodeURIComponent(uuid)}`, {
      headers: { 'Content-Type': 'application/json' },
    })

    if (res.status === 404) {
      return null
    }

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(`${res.status}: ${error.error || 'Request failed'}`)
    }

    return res.json()
  },
}

export const blocks = isDemoMode ? demoApi.blocks : _blocks

// ============================================================================
// Import API
// ============================================================================

export interface ImportLogseqRequest {
  sourcePath: string
  overwrite?: boolean
  dryRun?: boolean
}

export interface BrokenLink {
  sourceFile: string
  target: string
}

export interface ImportResult {
  pagesImported: number
  journalsImported: number
  skipped: number
  brokenLinks: BrokenLink[]
  warnings: string[]
  dryRun: boolean
}

export type ImportProgress =
  | { type: 'started'; message: string }
  | { type: 'extracting'; message: string }
  | { type: 'processing'; current: number; total: number; file: string }
  | { type: 'imported'; file: string; target: string }
  | { type: 'skipped'; file: string; reason: string }
  | { type: 'failed'; file: string; error: string }
  | { type: 'completed'; pagesImported: number; journalsImported: number; skipped: number; failed: number; hasAssets: boolean }
  | { type: 'error'; message: string }

export interface ImportErrorSummary {
  name: string
  originalName: string
  error: string
  timestamp: string
}

export interface ImportErrorList {
  errors: ImportErrorSummary[]
}

export interface ImportError {
  originalName: string
  error: string
  content: string
  timestamp: string
  source: string
}

export interface AcceptErrorRequest {
  contentType: string
  date?: string
  content?: string
  name?: string
}

const _importApi = {
  logseq: (req: ImportLogseqRequest) =>
    fetchJson<ImportResult>(`${API_BASE}/import/logseq`, {
      method: 'POST',
      body: JSON.stringify(req),
    }),

  uploadLogseqZip: async (
    file: File,
    options: { overwrite?: boolean; importAssets?: boolean },
    onProgress: (progress: ImportProgress) => void
  ): Promise<void> => {
    const formData = new FormData()
    formData.append('file', file)
    if (options.overwrite) formData.append('overwrite', 'true')
    if (options.importAssets) formData.append('importAssets', 'true')

    const response = await fetch(`${API_BASE}/import/logseq/upload`, {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(`${response.status}: ${error.error || 'Upload failed'}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.trim()) {
          try {
            const progress = JSON.parse(line) as ImportProgress
            onProgress(progress)
          } catch {
            // Ignore malformed progress lines
          }
        }
      }
    }

    if (buffer.trim()) {
      try {
        const progress = JSON.parse(buffer) as ImportProgress
        onProgress(progress)
      } catch {
        // Ignore malformed final progress line
      }
    }
  },

  errors: {
    list: () => fetchJson<ImportErrorList>(`${API_BASE}/import/errors`),

    get: (name: string) =>
      fetchJson<ImportError>(`${API_BASE}/import/errors/${encodeURIComponent(name)}`),

    delete: (name: string) =>
      fetchJson<{ deleted: string }>(`${API_BASE}/import/errors/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      }),

    deleteAll: () =>
      fetchJson<{ deleted: number }>(`${API_BASE}/import/errors`, {
        method: 'DELETE',
      }),

    accept: (name: string, req: AcceptErrorRequest) =>
      fetchJson<{ saved: string; contentType: string; path: string }>(
        `${API_BASE}/import/errors/${encodeURIComponent(name)}/accept`,
        {
          method: 'POST',
          body: JSON.stringify(req),
        }
      ),
  },
}

export const importApi = isDemoMode ? demoApi.importApi : _importApi

// ============================================================================
// Reindex API
// ============================================================================

export interface ReindexResponse {
  pagesIndexed: number
  journalsIndexed: number
  linkEntries: number
  blockCount: number | null
  searchDocs: number | null
  message: string
}

const _reindex = {
  rebuildAll: () =>
    fetchJson<ReindexResponse>(`${API_BASE}/reindex`, {
      method: 'POST',
    }),
}

export const reindex = isDemoMode ? demoApi.reindex : _reindex

// ============================================================================
// Stabilize API
// ============================================================================

export interface StabilizeResponse {
  stabilized: number
  alreadyStable: number
  failed: number
  message: string
}

const _stabilize = {
  stabilizeUuids: () =>
    fetchJson<StabilizeResponse>(`${API_BASE}/stabilize`, {
      method: 'POST',
    }),
}

export const stabilize = isDemoMode ? demoApi.stabilize : _stabilize
