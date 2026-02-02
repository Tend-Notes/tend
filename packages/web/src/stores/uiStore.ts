// SPDX-License-Identifier: MIT WITH Commons-Clause
// UI state management

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ContentType } from './settingsStore'

// Sidebar modes
export type SidebarMode = 'navigation' | 'history' | 'graph' | 'options' | 'tags' | 'todos'

interface UIState {
  // Sidebar
  sidebarOpen: boolean
  sidebarWidth: number
  sidebarMode: SidebarMode

  // Panels
  backlinksOpen: boolean
  graphOpen: boolean
  searchOpen: boolean

  // Command palette
  commandPaletteOpen: boolean
  /** Content type to create when command palette opens (for slash command integration) */
  pendingContentType: ContentType | null
  /** Callback to invoke when a sheet is created (e.g., to insert a link) */
  onSheetCreated: ((link: string) => void) | null

  // Import dialog
  importDialogOpen: boolean

  // Editor integration
  /** Callback to insert text at the current cursor position in the editor */
  insertTextAtCursor: ((text: string) => void) | null
  /** UUID of the last focused block (persists when focus leaves editor) */
  lastFocusedBlockUuid: string | null

  // Theme
  theme: string

  // Actions
  toggleSidebar: () => void
  setSidebarWidth: (width: number) => void
  setSidebarMode: (mode: SidebarMode) => void
  toggleBacklinks: () => void
  toggleGraph: () => void
  toggleSearch: () => void
  openSearch: () => void
  closeSearch: () => void
  setTheme: (theme: string) => void
  openCommandPalette: () => void
  openCommandPaletteForContentType: (contentType: ContentType, onCreated?: (link: string) => void) => void
  closeCommandPalette: () => void
  clearPendingContentType: () => void
  openImportDialog: () => void
  closeImportDialog: () => void
  setInsertTextAtCursor: (fn: ((text: string) => void) | null) => void
  setLastFocusedBlockUuid: (uuid: string | null) => void
  reset: () => void
  resetAll: () => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: false,
      sidebarWidth: 328, // ~15% wider than previous default (285)
      sidebarMode: 'navigation' as SidebarMode,
      backlinksOpen: false,
      graphOpen: false,
      searchOpen: false,
      theme: 'one-dark',

      toggleSidebar: () =>
        set((state) => ({ sidebarOpen: !state.sidebarOpen })),

      setSidebarWidth: (width) => {
        // Min: 15% smaller than default (279px), Max: 40% of viewport
        const minWidth = 279
        const maxWidth = typeof window !== 'undefined' ? window.innerWidth * 0.4 : 500
        set({ sidebarWidth: Math.max(minWidth, Math.min(maxWidth, width)) })
      },

      setSidebarMode: (mode) => set({ sidebarMode: mode }),

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

      // Command palette
      commandPaletteOpen: false,
      pendingContentType: null,
      onSheetCreated: null as ((link: string) => void) | null,
      openCommandPalette: () => set({ commandPaletteOpen: true }),
      openCommandPaletteForContentType: (contentType, onCreated) =>
        set({ commandPaletteOpen: true, pendingContentType: contentType, onSheetCreated: onCreated || null }),
      closeCommandPalette: () => set({ commandPaletteOpen: false, pendingContentType: null, onSheetCreated: null }),
      clearPendingContentType: () => set({ pendingContentType: null }),

      // Import dialog
      importDialogOpen: false,
      openImportDialog: () => set({ importDialogOpen: true }),
      closeImportDialog: () => set({ importDialogOpen: false }),

      // Editor integration
      insertTextAtCursor: null as ((text: string) => void) | null,
      setInsertTextAtCursor: (fn) => set({ insertTextAtCursor: fn }),
      lastFocusedBlockUuid: null as string | null,
      setLastFocusedBlockUuid: (uuid) => set({ lastFocusedBlockUuid: uuid }),

      // Reset transient UI state (for garden switching)
      // Preserves user preferences: sidebarOpen, sidebarWidth, theme
      reset: () => set({
        sidebarMode: 'navigation' as SidebarMode,
        backlinksOpen: false,
        graphOpen: false,
        searchOpen: false,
        commandPaletteOpen: false,
        pendingContentType: null,
        onSheetCreated: null,
        importDialogOpen: false,
        insertTextAtCursor: null,
        lastFocusedBlockUuid: null,
      }),

      // Full reset for user switching - clears all state including preferences
      resetAll: () => set({
        sidebarOpen: false,
        sidebarWidth: 328,
        sidebarMode: 'navigation' as SidebarMode,
        backlinksOpen: false,
        graphOpen: false,
        searchOpen: false,
        theme: 'one-dark',
        commandPaletteOpen: false,
        pendingContentType: null,
        onSheetCreated: null,
        importDialogOpen: false,
        insertTextAtCursor: null,
        lastFocusedBlockUuid: null,
      }),
    }),
    {
      name: 'tend-ui',
      // Don't persist command palette state
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        sidebarWidth: state.sidebarWidth,
        sidebarMode: state.sidebarMode,
        backlinksOpen: state.backlinksOpen,
        graphOpen: state.graphOpen,
        searchOpen: state.searchOpen,
        theme: state.theme,
      }),
    }
  )
)
