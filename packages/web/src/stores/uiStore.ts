// SPDX-License-Identifier: MIT WITH Commons-Clause
// UI state management

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UIState {
  // Sidebar
  sidebarOpen: boolean
  sidebarWidth: number

  // Panels
  backlinksOpen: boolean
  graphOpen: boolean
  searchOpen: boolean

  // Theme
  theme: string

  // Actions
  toggleSidebar: () => void
  setSidebarWidth: (width: number) => void
  toggleBacklinks: () => void
  toggleGraph: () => void
  toggleSearch: () => void
  openSearch: () => void
  closeSearch: () => void
  setTheme: (theme: string) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: false,
      sidebarWidth: 328, // ~15% wider than previous default (285)
      backlinksOpen: false,
      graphOpen: false,
      searchOpen: false,
      theme: 'one-dark',

      toggleSidebar: () =>
        set((state) => ({ sidebarOpen: !state.sidebarOpen })),

      setSidebarWidth: (width) => {
        // Min: 15% smaller than default (279px), Max: 50% of viewport
        const minWidth = 279
        const maxWidth = typeof window !== 'undefined' ? window.innerWidth * 0.5 : 600
        set({ sidebarWidth: Math.max(minWidth, Math.min(maxWidth, width)) })
      },

      toggleBacklinks: () =>
        set((state) => ({ backlinksOpen: !state.backlinksOpen })),

      toggleGraph: () =>
        set((state) => ({ graphOpen: !state.graphOpen })),

      toggleSearch: () =>
        set((state) => ({ searchOpen: !state.searchOpen })),

      openSearch: () =>
        set({ searchOpen: true }),

      closeSearch: () =>
        set({ searchOpen: false }),

      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'tend-ui',
    }
  )
)
