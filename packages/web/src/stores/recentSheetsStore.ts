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
const MAX_RECENT_TAGS = 10

// Simplified tag info for sidebar display
interface RecentTag {
  name: string  // e.g., "project" (without # or tags/ prefix)
}

interface RecentSheetsState {
  // Recent sheets keyed by content type ID
  // e.g., { page: [...], journal: [...], meeting: [...] }
  recentSheets: Record<string, PageMeta[]>

  // Recently visited tags (separate from sheets)
  recentTags: RecentTag[]

  // Actions
  recordAccess: (contentTypeId: string, sheet: PageMeta) => void
  recordTagAccess: (tagName: string) => void
  removeSheet: (name: string) => void
  clearAll: () => void
  clearByType: (contentTypeId: string) => void
}

export const useRecentSheetsStore = create<RecentSheetsState>()(
  persist(
    (set) => ({
      recentSheets: {},
      recentTags: [],

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

      recordTagAccess: (tagName) => {
        set((state) => {
          // Remove existing entry to avoid duplicates
          const filtered = state.recentTags.filter((t) => t.name !== tagName)

          // Add to front (most recent first)
          const updated = [{ name: tagName }, ...filtered].slice(0, MAX_RECENT_TAGS)

          return { recentTags: updated }
        })
      },

      removeSheet: (name) => {
        set((state) => {
          const updated: Record<string, PageMeta[]> = {}
          for (const [contentTypeId, sheets] of Object.entries(state.recentSheets)) {
            const filtered = sheets.filter((s) => s.name !== name)
            if (filtered.length > 0) {
              updated[contentTypeId] = filtered
            }
          }
          return { recentSheets: updated }
        })
      },

      clearAll: () => {
        set({ recentSheets: {}, recentTags: [] })
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
      // Migration: filter out tag pages from sheets, add recentTags array
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as {
          recentSheets?: Record<string, PageMeta[]>
          recentTags?: RecentTag[]
        }

        // v0 -> v1: filter tags from sheets
        // v1 -> v2: add recentTags array
        if (version < 2) {
          const cleaned: Record<string, PageMeta[]> = {}
          if (state.recentSheets) {
            for (const [key, sheets] of Object.entries(state.recentSheets)) {
              cleaned[key] = sheets.filter((s) => !s.name.startsWith('tags/'))
            }
          }
          return {
            ...state,
            recentSheets: cleaned,
            recentTags: state.recentTags || [],
          }
        }
        return state
      },
      version: 2,
    }
  )
)
