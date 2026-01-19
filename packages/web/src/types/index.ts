// SPDX-License-Identifier: MIT WITH Commons-Clause

// Block data model
export interface Block {
  uuid: string
  content: string
  parentUuid: string | null
  children: string[]
  collapsed: boolean
  properties: Record<string, string>
  depth: number
}

// Page data model
export interface Page {
  name: string
  title: string
  rootBlocks: string[]
  blocks: Record<string, Block>
  properties: Record<string, string>
  isJournal: boolean
  journalDate: string | null
  createdAt: string
  modifiedAt: string
}

// Page metadata (for lists)
export interface PageMeta {
  name: string
  title: string
  isJournal: boolean
  journalDate: string | null
  blockCount: number
  createdAt: string
  modifiedAt: string
}

// Search result
export interface SearchResult {
  uuid: string
  content: string
  pageName: string
  pageTitle: string
  isJournal: boolean
  score: number
}

// Backlink reference
export interface BacklinkRef {
  pageName: string
  pageTitle: string
  blockUuid: string
  blockContent: string
  isJournal: boolean
  journalDate: string | null
}

// Graph data
export interface GraphNode {
  id: string
  label: string
  isJournal: boolean
  blockCount: number
}

export interface GraphEdge {
  source: string
  target: string
  weight: number
}

export interface Graph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// Git status
export interface GitStatus {
  isRepo: boolean
  hasChanges: boolean
  branch: string | null
  remote: string | null
  ahead: number
  behind: number
}

// Backup result
export interface BackupResult {
  success: boolean
  commitSha: string | null
  message: string
  timestamp: string
}
