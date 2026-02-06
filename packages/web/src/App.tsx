// SPDX-License-Identifier: MIT WITH Commons-Clause
import { lazy, Suspense, useEffect, useState } from 'react'
import { Sidebar } from './components/sidebar/Sidebar'
import { MainContent } from './components/layout/MainContent'
import { DraftRecoveryDialog } from './components/ui/DraftRecoveryDialog'
import { ConflictResolutionDialog } from './components/ui/ConflictResolutionDialog'
import { LogseqImportDialog } from './components/ui/LogseqImportDialog'
import { WorkTimerBanner } from './components/ui/WorkTimerBanner'
import { usePageStore } from './stores/pageStore'
import { useRecentSheetsStore } from './stores/recentSheetsStore'
import { useTagStore } from './stores/tagStore'

// Lazy load heavy/rarely-used components to reduce initial bundle size
const CommandPalette = lazy(() => import('./components/command-palette/CommandPalette'))
const SearchPanel = lazy(() => import('./components/search/SearchPanel'))
const KeyboardHelp = lazy(() => import('./components/ui/KeyboardHelp'))
import { Toasts } from './components/ui/Toasts'
import { useUIStore } from './stores/uiStore'
import { useSettingsStore } from './stores/settingsStore'
import { useAutoCommit } from './hooks/useAutoCommit'
import { formatDateYMD } from './lib/dateUtils'
import { useWebSocket } from './hooks/useWebSocket'
import { useTheme } from './hooks/useTheme'
import { contentTypes as contentTypesApi, identity } from './lib/api'
import { initUserSync } from './lib/userSync'

function App() {
  const [keyboardHelpOpen, setKeyboardHelpOpen] = useState(false)
  const sidebarMode = useUIStore((state) => state.sidebarMode)
  const setSidebarMode = useUIStore((state) => state.setSidebarMode)
  const commandPaletteOpen = useUIStore((state) => state.commandPaletteOpen)
  const openCommandPalette = useUIStore((state) => state.openCommandPalette)
  const closeCommandPalette = useUIStore((state) => state.closeCommandPalette)
  const importDialogOpen = useUIStore((state) => state.importDialogOpen)
  const closeImportDialog = useUIStore((state) => state.closeImportDialog)
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
    // Load user preferences and state from server (multi-tenant support)
    // This overwrites any localStorage cache with the server's authoritative data
    identity.whoami()
      .then(async ({ username }) => {
        const lastUser = localStorage.getItem('tend-last-user')
        if (lastUser && lastUser !== username) {
          // Clear localStorage cache - server will provide correct data
          clearRecentSheets()
          clearTags()
          // Redirect to home - current path may not exist for new user
          window.history.replaceState(null, '', '/')
        }
        localStorage.setItem('tend-last-user', username)

        // Load user's preferences and state from server, then start syncing
        await initUserSync()

        // Initialize page from URL AFTER user sync (URL may have been redirected)
        initializeFromUrl()
      })
      .catch((err) => console.error('Failed to get current user:', err))

    // Load content types from API (needed for content type routing)
    contentTypesApi.list()
      .then((types) => {
        setContentTypes(types)
      })
      .catch((err) => console.error('Failed to load content types:', err))
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

      // Alt + Shift + J - Navigate to today's journal (Home, works even when editing)
      if (e.altKey && e.shiftKey && e.code === 'KeyJ') {
        e.preventDefault()
        navigateToJournal(formatDateYMD(new Date()))
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
  }, [keyboardHelpOpen, sidebarMode, toggleSidebar, openSearch, openCommandPalette, setSidebarMode, navigateToJournal])

  return (
    <div className="flex flex-col h-screen w-full max-w-full overflow-hidden bg-base-00 text-base-05">
      {/* Work timer banner - shows at very top when active */}
      <WorkTimerBanner />

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <Sidebar
          mode={sidebarMode}
          onModeChange={setSidebarMode}
        />

        {/* Main content area */}
        <MainContent />
      </div>

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

      {/* Logseq import dialog */}
      <LogseqImportDialog
        open={importDialogOpen}
        onOpenChange={(open) => !open && closeImportDialog()}
      />

      {/* Toast notifications */}
      <Toasts />
    </div>
  )
}

export default App
