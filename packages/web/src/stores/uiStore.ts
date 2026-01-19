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
      sidebarWidth: 285,
      backlinksOpen: false,
      graphOpen: false,
      searchOpen: false,
      theme: 'one-dark',

      toggleSidebar: () =>
        set((state) => ({ sidebarOpen: !state.sidebarOpen })),

      setSidebarWidth: (width) =>
        set({ sidebarWidth: Math.max(200, Math.min(400, width)) }),

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
