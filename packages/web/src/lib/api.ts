// SPDX-License-Identifier: MIT WITH Commons-Clause
// API client for Tend backend

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
} from '../types'

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

// Pages API
export const pages = {
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

// Journals API
export const journals = {
  list: () => fetchJson<PageMeta[]>(`${API_BASE}/journals`),

  getToday: () => fetchJson<Page>(`${API_BASE}/journals/today`),

  get: (date: string) => fetchJson<Page>(`${API_BASE}/journals/${date}`),

  update: (date: string, blocks: BlockData[], version?: number) =>
    fetchJson<Page>(`${API_BASE}/journals/${date}`, {
      method: 'PUT',
      body: JSON.stringify({ blocks, version }),
    }),
}

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

// Search API
export const search = {
  query: (q: string, limit = 20) =>
    fetchJson<SearchResponse>(`${API_BASE}/search?q=${encodeURIComponent(q)}&limit=${limit}`),
}

// Graph API
export const graph = {
  get: () => fetchJson<Graph>(`${API_BASE}/graph`),
}

// Tag info from API
export interface TagInfo {
  name: string
  count: number
}

// Tags API
export const tags = {
  list: () => fetchJson<TagInfo[]>(`${API_BASE}/tags`),
}

// Task item from API
export interface TaskItem {
  uuid: string
  status: string
  content: string
  pageName: string
  pageTitle: string
  isJournal: boolean
  journalDate: string | null
}

// Task list from API
export interface TaskList {
  tasks: TaskItem[]
}

// Todos API
export const todos = {
  list: () => fetchJson<TaskList>(`${API_BASE}/todos`),
}

// Git API
export const git = {
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

// Garden types
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

// Response type for switch - may indicate unlock required
export interface SwitchResponse {
  active?: string
  message: string
  unlock_required?: boolean
  garden_id?: string
}

/** Options for creating an encrypted garden */
export interface CreateGardenOptions {
  name: string
  path: string
  /** Passphrase for encryption. If provided, the garden will be encrypted. */
  passphrase?: string
  /** Enable search for encrypted gardens (creates plaintext index). Default: false for encrypted. */
  searchEnabled?: boolean
  /** Hours after last use before search index is auto-deleted. Default: 6 for encrypted. */
  indexTtlHours?: number
}

// Gardens API
export const gardens = {
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
}

// Import types
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

// Import API
export const importApi = {
  logseq: (req: ImportLogseqRequest) =>
    fetchJson<ImportResult>(`${API_BASE}/import/logseq`, {
      method: 'POST',
      body: JSON.stringify(req),
    }),
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

// Content Type definition (matches backend)
export interface ContentType {
  id: string
  name: string
  directory: string
  saveByDate: boolean
  template: string
}

// Content Types API
export const contentTypes = {
  list: () => fetchJson<ContentType[]>(`${API_BASE}/content-types`),

  update: (types: ContentType[]) =>
    fetchJson<ContentType[]>(`${API_BASE}/content-types`, {
      method: 'PUT',
      body: JSON.stringify({ content_types: types }),
    }),
}

// Sheets API (generic content type operations)
export const sheets = {
  list: (contentTypeId: string) =>
    fetchJson<PageMeta[]>(`${API_BASE}/sheets/${encodeURIComponent(contentTypeId)}`),

  get: (contentTypeId: string, name: string, date?: string) => {
    const params = date ? `?date=${encodeURIComponent(date)}` : ''
    return fetchJson<Page>(`${API_BASE}/sheets/${encodeURIComponent(contentTypeId)}/${encodeURIComponent(name)}${params}`)
  },

  create: (contentTypeId: string, name: string, options?: { date?: string; content?: string }) =>
    fetchJson<Page>(`${API_BASE}/sheets/${encodeURIComponent(contentTypeId)}`, {
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
