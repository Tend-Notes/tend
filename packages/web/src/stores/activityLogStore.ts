// SPDX-License-Identifier: MIT WITH Commons-Clause
// Activity log state management - tracks file saves, git commits, etc.

import { create } from 'zustand'

export type ActivityType = 'file_save' | 'git_commit' | 'git_auto_commit' | 'git_error' | 'file_change'

export interface ActivityEntry {
  id: string
  type: ActivityType
  message: string
  timestamp: number
  details?: string
}

interface ActivityLogState {
  entries: ActivityEntry[]
  maxEntries: number

  // Actions
  addEntry: (type: ActivityType, message: string, details?: string) => void
  clearEntries: () => void
}

// Generate a simple unique ID
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export const useActivityLogStore = create<ActivityLogState>()((set) => ({
  entries: [],
  maxEntries: 50,

  addEntry: (type, message, details) => {
    const entry: ActivityEntry = {
      id: generateId(),
      type,
      message,
      timestamp: Date.now(),
      details,
    }

    set((state) => ({
      entries: [entry, ...state.entries].slice(0, state.maxEntries),
    }))
  },

  clearEntries: () => {
    set({ entries: [] })
  },
}))

// Helper to format relative time
export function formatActivityTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp

  if (diff < 1000) return 'just now'
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`

  const date = new Date(timestamp)
  return date.toLocaleString()
}
