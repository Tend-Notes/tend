// SPDX-License-Identifier: MIT WITH Commons-Clause
import { lazy, Suspense, useEffect, useState } from 'react'
import { Sidebar } from './components/sidebar/Sidebar'
import { MainContent } from './components/layout/MainContent'
import { DraftRecoveryDialog } from './components/ui/DraftRecoveryDialog'
import { ConflictResolutionDialog } from './components/ui/ConflictResolutionDialog'
import { usePageStore } from './stores/pageStore'
import { useRecentSheetsStore } from './stores/recentSheetsStore'
import { useTagStore } from './stores/tagStore'

// Lazy load heavy/rarely-used components to reduce initial bundle size
const CommandPalette = lazy(() => import('./components/command-palette/CommandPalette'))
const SearchPanel = lazy(() => import('./components/search/SearchPanel'))
const KeyboardHelp = lazy(() => import('./components/ui/KeyboardHelp'))
import { useUIStore } from './stores/uiStore'
import { useSettingsStore } from './stores/settingsStore'
import { useAutoCommit } from './hooks/useAutoCommit'
import { useWebSocket } from './hooks/useWebSocket'
import { useTheme } from './hooks/useTheme'
import { contentTypes as contentTypesApi, identity } from './lib/api'

function App() {
  const [keyboardHelpOpen, setKeyboardHelpOpen] = useState(false)
  const sidebarMode = useUIStore((state) => state.sidebarMode)
  const setSidebarMode = useUIStore((state) => state.setSidebarMode)
  const commandPaletteOpen = useUIStore((state) => state.commandPaletteOpen)
  const openCommandPalette = useUIStore((state) => state.openCommandPalette)
  const closeCommandPalette = useUIStore((state) => state.closeCommandPalette)
    const initializeFromUrl = usePageStore((state) => state.initializeFromUrl)
  const navigateToPage = usePageStore((state) => state.navigateToPage)
  const navigateToJournal = usePageStore((state) => state.navigateToJournal)
  const toggleSidebar = useUIStore((state) => state.toggleSidebar)
  const openSearch = useUIStore((state) => state.openSearch)
  const setContentTypes = useSettingsStore((state) => state.setContentTypes)
  const clearRecentSheets = useRecentSheetsStore((state) => state.clearAll)
  const clearTags = useTagStore((state) => state.reset)

  // Initialize auto-commit system
  useAutoCommit()

  // Initialize WebSocket connection for real-time updates
  useWebSocket()

  // Apply theme based on user settings
  useTheme()

  // Load initial data and handle URL - runs once on mount
  useEffect(() => {
    // Check if user changed (multi-tenant support)
    // If so, clear user-scoped localStorage to prevent data leakage
    identity.whoami()
      .then(({ username }) => {
        const lastUser = localStorage.getItem('tend-last-user')
        if (lastUser && lastUser !== username) {
          console.log(`User changed from ${lastUser} to ${username}, clearing cached data`)
          // Clear data stores that reference user-specific content
          // (pages, tags are per-user on the server)
          clearRecentSheets()
          clearTags()
          // Note: settings/UI/git stores are browser preferences, not user data
          // To have per-user preferences, would need to scope localStorage keys by username
        }
        localStorage.setItem('tend-last-user', username)
      })
      .catch((err) => console.error('Failed to get current user:', err))

    // Load content types from API (needed for content type routing)
    contentTypesApi.list()
      .then((types) => {
        setContentTypes(types)
      })
      .catch((err) => console.error('Failed to load content types:', err))

    initializeFromUrl()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Run only on mount - these are stable store actions

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as { type: 'page' | 'journal'; name: string } | null
      if (state) {
        if (state.type === 'journal') {
          navigateToJournal(state.name, false)
        } else {
          navigateToPage(state.name, false)
        }
      } else {
        // No state means we're at the initial URL - reinitialize
        initializeFromUrl()
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [navigateToPage, navigateToJournal, initializeFromUrl])

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs (except for specific ones)
      const target = e.target as HTMLElement
      const isEditing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

      // Escape - close any open overlay or reset sidebar mode
      if (e.key === 'Escape') {
        if (keyboardHelpOpen) {
          setKeyboardHelpOpen(false)
          e.preventDefault()
          return
        }
        if (sidebarMode !== 'navigation') {
          setSidebarMode('navigation')
          e.preventDefault()
          return
        }
      }

      // Ctrl + Shift + / - Toggle keyboard help (works even when editing)
      if (e.ctrlKey && e.shiftKey && e.code === 'Slash') {
        e.preventDefault()
        setKeyboardHelpOpen((prev) => !prev)
        return
      }

      // Alt + Shift + P - Command palette (works even when editing)
      // Use e.code for physical key (macOS Alt produces special characters with e.key)
      if (e.altKey && e.shiftKey && e.code === 'KeyP') {
        e.preventDefault()
        openCommandPalette()
        return
      }

      // Skip other shortcuts if we're editing
      if (isEditing) return

      // Alt + Shift + S - Toggle sidebar
      if (e.altKey && e.shiftKey && e.code === 'KeyS') {
        e.preventDefault()
        toggleSidebar()
        return
      }

      // Alt + Shift + F - Search
      if (e.altKey && e.shiftKey && e.code === 'KeyF') {
        e.preventDefault()
        openSearch()
        return
      }

      // Alt + Shift + O - Options (toggle sidebar options mode)
      if (e.altKey && e.shiftKey && e.code === 'KeyO') {
        e.preventDefault()
        setSidebarMode(sidebarMode === 'options' ? 'navigation' : 'options')
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [keyboardHelpOpen, sidebarMode, toggleSidebar, openSearch, openCommandPalette, setSidebarMode])

  return (
    <div className="flex h-screen w-full max-w-full overflow-hidden bg-base-00 text-base-05">
      {/* Sidebar */}
      <Sidebar
        mode={sidebarMode}
        onModeChange={setSidebarMode}
      />

      {/* Main content area */}
      <MainContent />

      {/* Lazy-loaded overlays wrapped in Suspense */}
      <Suspense fallback={null}>
        {/* Command palette */}
        <CommandPalette
          open={commandPaletteOpen}
          onOpenChange={(open) => open ? openCommandPalette() : closeCommandPalette()}
        />

        {/* Search panel */}
        <SearchPanel />

        {/* Keyboard help overlay */}
        <KeyboardHelp
          open={keyboardHelpOpen}
          onClose={() => setKeyboardHelpOpen(false)}
        />
      </Suspense>

      {/* Draft recovery dialog */}
      <DraftRecoveryDialog />

      {/* Conflict resolution dialog */}
      <ConflictResolutionDialog />

    </div>
  )
}

export default App
