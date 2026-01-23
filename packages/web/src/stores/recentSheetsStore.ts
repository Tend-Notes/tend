// SPDX-License-Identifier: MIT WITH Commons-Clause
// Recent sheets store - tracks locally accessed sheets per content type
//
// This store maintains a running tally of the most recently accessed sheets
// for each content type. The data is persisted to localStorage and is purely
// client-side - it does NOT fetch from the server.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PageMeta } from '../types'

// Maximum number of recent sheets to track per content type
const MAX_RECENT_PER_TYPE = 10

interface RecentSheetsState {
  // Recent sheets keyed by content type ID
  // e.g., { page: [...], journal: [...], meeting: [...] }
  recentSheets: Record<string, PageMeta[]>

  // Actions
  recordAccess: (contentTypeId: string, sheet: PageMeta) => void
  clearAll: () => void
  clearByType: (contentTypeId: string) => void
}

export const useRecentSheetsStore = create<RecentSheetsState>()(
  persist(
    (set) => ({
      recentSheets: {},

      recordAccess: (contentTypeId, sheet) => {
        set((state) => {
          const current = state.recentSheets[contentTypeId] || []

          // Remove existing entry for this sheet (by name) to avoid duplicates
          const filtered = current.filter((s) => s.name !== sheet.name)

          // Add to front (most recent first)
          const updated = [sheet, ...filtered].slice(0, MAX_RECENT_PER_TYPE)

          return {
            recentSheets: {
              ...state.recentSheets,
              [contentTypeId]: updated,
            },
          }
        })
      },

      clearAll: () => {
        set({ recentSheets: {} })
      },

      clearByType: (contentTypeId) => {
        set((state) => {
          const { [contentTypeId]: _, ...rest } = state.recentSheets
          return { recentSheets: rest }
        })
      },
    }),
    {
      name: 'tend-recent-sheets',
      // Migration: filter out tag pages from persisted data
      migrate: (persistedState: unknown) => {
        const state = persistedState as { recentSheets?: Record<string, PageMeta[]> }
        if (state.recentSheets) {
          const cleaned: Record<string, PageMeta[]> = {}
          for (const [key, sheets] of Object.entries(state.recentSheets)) {
            cleaned[key] = sheets.filter((s) => !s.name.startsWith('tags/'))
          }
          return { ...state, recentSheets: cleaned }
        }
        return state
      },
      version: 1,
    }
  )
)
