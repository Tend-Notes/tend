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

// Search API
export const search = {
  query: (q: string, limit = 20) =>
    fetchJson<SearchResult[]>(`${API_BASE}/search?q=${encodeURIComponent(q)}&limit=${limit}`),
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
}

// Garden types
export interface Garden {
  id: string
  name: string
  path: string
}

export interface ArchivedGarden {
  id: string
  name: string
  path: string
  archived_at: string  // snake_case from Rust API
}

export interface GardensResponse {
  gardens: Garden[]
  active: string
  archived?: ArchivedGarden[]
}

// Gardens API
export const gardens = {
  list: () => fetchJson<GardensResponse>(`${API_BASE}/gardens`),

  create: (name: string, path: string) =>
    fetchJson<Garden>(`${API_BASE}/gardens`, {
      method: 'POST',
      body: JSON.stringify({ name, path }),
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
    fetchJson<{ active: string; message: string }>(`${API_BASE}/gardens/switch`, {
      method: 'POST',
      body: JSON.stringify({ id }),
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
