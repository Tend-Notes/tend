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
  /** Content type ID (e.g., "page", "journal", "meeting") */
  contentType: string
  isJournal: boolean
  /** Journal date (for journals) or sheet date (for saveByDate content types) */
  journalDate: string | null
  createdAt: string
  modifiedAt: string
  /** Version number for conflict detection (increments on each save) */
  version: number
}

// Page metadata (for lists)
export interface PageMeta {
  name: string
  title: string
  /** Content type ID (e.g., "page", "journal", "meeting") */
  contentType: string
  isJournal: boolean
  /** Journal date (for journals) or sheet date (for saveByDate content types) */
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
  /** Content type ID (e.g., "page", "journal", "meetings") */
  contentType: string
  blockCount: number
}

export interface GraphEdge {
  source: string
  target: string
  weight: number
}

export interface GraphContentType {
  id: string
  name: string
}

export interface Graph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Content types present in the graph (for legend) */
  contentTypes: GraphContentType[]
}

// Git status
export interface GitStatus {
  isRepo: boolean
  hasChanges: boolean
  branch: string | null
  remote: string | null
  /** Whether the local branch has an upstream tracking branch configured */
  hasUpstream: boolean
  ahead: number
  behind: number
  changedFiles: ChangedFile[]
}

// Changed file in git status
export interface ChangedFile {
  path: string
  status: FileStatus
}

// File status enum
export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'

// Backup result
export interface BackupResult {
  success: boolean
  commitSha: string | null
  message: string
  timestamp: string
}

// Commit info for history
export interface CommitInfo {
  sha: string
  shortSha: string
  message: string
  author: string
  timestamp: string
  filesChanged: number
}

// Diff for a commit
export interface CommitDiff {
  sha: string
  message: string
  timestamp: string
  files: FileDiff[]
}

// Diff for a single file
export interface FileDiff {
  path: string
  status: FileStatus
  diff: string
}

// Result of push/pull operations
export interface PushResult {
  success: boolean
  message: string
  details: string
}

// Result of setting or testing a remote
export interface RemoteResult {
  success: boolean
  url: string
  message: string
  verified: boolean
}

// Result of importing a remote garden via git
export interface GitImportResult {
  success: boolean
  message: string
  filesChanged: number
}

// Information about a garden detected in a remote repository
export interface RemoteGardenInfo {
  found: boolean
  name: string | null
}
