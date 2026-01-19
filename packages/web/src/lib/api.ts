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

  update: (name: string, blocks: BlockData[]) =>
    fetchJson<Page>(`${API_BASE}/pages/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ blocks }),
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

  update: (date: string, blocks: BlockData[]) =>
    fetchJson<Page>(`${API_BASE}/journals/${date}`, {
      method: 'PUT',
      body: JSON.stringify({ blocks }),
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

  diff: (commitSha: string) =>
    fetchJson<CommitDiff>(`${API_BASE}/git/diff/${encodeURIComponent(commitSha)}`),

  restore: (commitSha: string) =>
    fetchJson<BackupResult>(`${API_BASE}/git/restore`, {
      method: 'POST',
      body: JSON.stringify({ commit: commitSha }),
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
