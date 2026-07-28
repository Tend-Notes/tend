// SPDX-License-Identifier: MIT WITH Commons-Clause
import { lazy, Suspense, useEffect, useState } from 'react'
import { Sidebar } from './components/sidebar/Sidebar'
import { MainContent } from './components/layout/MainContent'
import { DraftRecoveryDialog } from './components/ui/DraftRecoveryDialog'
import { ConflictResolutionDialog } from './components/ui/ConflictResolutionDialog'
// Lazy: this dialog (and its framer-motion dependency) is only needed when the
// user opens the Logseq import, so keep it out of the initial chunk.
const LogseqImportDialog = lazy(() =>
  import('./components/ui/LogseqImportDialog').then((m) => ({ default: m.LogseqImportDialog }))
)
import { WorkTimerBanner } from './components/ui/WorkTimerBanner'
import { DemoBanner } from './components/ui/DemoBanner'
import { DemoWelcomeOverlay } from './components/ui/DemoWelcomeOverlay'
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
import { useWebSocket } from './hooks/useWebSocket'
import { useTheme } from './hooks/useTheme'
import { contentTypes as contentTypesApi, identity, isDemoMode, AuthExpiredError } from './lib/api'
import { useAuthStore } from './stores/authStore'
import { SessionExpiredOverlay } from './components/ui/SessionExpiredOverlay'
import { initUserSync } from './lib/userSync'
import { clearUserScopedContent } from './lib/cacheReset'

// Demo mode imports (only loaded in demo mode)
import { initializeDemoContent, resetDemoContent } from './lib/demoContent'
import { checkExpiry, initDemoDb } from './lib/demoStore'
import { contentTypes as demoContentTypes } from './lib/demoApi'

function App() {
  const [keyboardHelpOpen, setKeyboardHelpOpen] = useState(false)
  const [demoExpired, setDemoExpired] = useState(false)
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
  const setContentTypes = useSettingsStore((state) => state.setContentTypes)
  const clearRecentSheets = useRecentSheetsStore((state) => state.clearAll)
  const clearTags = useTagStore((state) => state.reset)

  // Initialize auto-commit system (skip in demo mode - no git)
  useAutoCommit()

  // Initialize WebSocket connection for real-time updates (skip in demo mode)
  useWebSocket()

  // Apply theme based on user settings
  useTheme()

  // Demo mode: Handle expiry reset
  const handleDemoReset = async () => {
    await resetDemoContent()
    setDemoExpired(false)
    window.location.reload()
  }

  // Load initial data and handle URL - runs once on mount
  useEffect(() => {
    if (isDemoMode) {
      // Demo mode initialization
      const initDemo = async () => {
        try {
          // Clear any cached state from previous non-demo sessions
          // This prevents showing stale data from backend-connected sessions
          const lastMode = localStorage.getItem('tend-last-mode')
          if (lastMode !== 'demo') {
            clearRecentSheets()
            clearTags()
            usePageStore.getState().reset()
            useUIStore.getState().reset()
            localStorage.setItem('tend-last-mode', 'demo')
          }

          // Initialize IndexedDB
          await initDemoDb()

          // Check for expiry
          const expired = await checkExpiry()
          if (expired) {
            setDemoExpired(true)
            return
          }

          // Initialize demo content if not already done
          await initializeDemoContent()

          // Load content types (hardcoded in demo mode)
          const types = await demoContentTypes.list()
          setContentTypes(types)

          // Initialize page from URL
          initializeFromUrl()
        } catch (err) {
          console.error('Failed to initialize demo mode:', err)
        }
      }
      initDemo()
    } else {
      // Normal mode: Load user preferences and state from server (multi-tenant support)
      // This overwrites any localStorage cache with the server's authoritative data
      const lastMode = localStorage.getItem('tend-last-mode')
      if (lastMode === 'demo') {
        // Clear ALL localStorage caches - switching from demo to server mode
        // This prevents demo content from appearing in regular mode
        clearRecentSheets()
        clearTags()
        usePageStore.getState().reset()
        useUIStore.getState().reset()
        useSettingsStore.getState().resetAll()
      }
      localStorage.setItem('tend-last-mode', 'server')
      identity.whoami()
        .then(async ({ username }) => {
          useAuthStore.getState().markSessionValid()
          const lastUser = localStorage.getItem('tend-last-user')
          if (lastUser && lastUser !== username) {
            // Clear ALL localStorage caches - different user, different data
            // This prevents User B from seeing User A's cached state
            clearRecentSheets()
            clearTags()
            usePageStore.getState().reset()
            useUIStore.getState().reset()
            useSettingsStore.getState().resetAll()
            // Also purge the service-worker content caches and unsaved drafts
            // so User B is never served User A's page/journal content.
            void clearUserScopedContent()
            // Redirect to home - current path may not exist for new user
            window.history.replaceState(null, '', '/')
          }
          localStorage.setItem('tend-last-user', username)

          // Load user's preferences and state from server, then start syncing
          await initUserSync()

          // Initialize page from URL AFTER user sync (URL may have been redirected)
          initializeFromUrl()
        })
        .catch((err) => {
          console.error('Failed to get current user:', err)
          if (err instanceof AuthExpiredError) {
            // api.ts already raised the session-expired flag; the overlay takes
            // over from here.
            return
          }
          // Any other failure must still initialize the page. Otherwise
          // pageStore.initialized stays false and MainContent shows "Loading..."
          // forever with no way out - which is exactly what an expired session
          // used to look like.
          initializeFromUrl()
        })

      // Load content types from API (needed for content type routing)
      contentTypesApi.list()
        .then((types) => {
          setContentTypes(types)
        })
        .catch((err) => console.error('Failed to load content types:', err))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Run only on mount - these are stable store actions

  // Re-check the session when the app comes back to the foreground.
  //
  // The common failure is a tab (or installed app) left open for days: the
  // proxy session lapses while nothing is running, and the user finds out only
  // when their next click quietly fails. Checking on wake surfaces it up front.
  useEffect(() => {
    if (isDemoMode) return

    const HIDDEN_THRESHOLD_MS = 5 * 60 * 1000
    let hiddenSince: number | null = null

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSince = Date.now()
        return
      }
      // Became visible. Only bother the server if we were away a while - the
      // check is cheap but pointless on a quick tab switch.
      const away = hiddenSince === null ? Infinity : Date.now() - hiddenSince
      hiddenSince = null
      if (away < HIDDEN_THRESHOLD_MS) return
      void useAuthStore.getState().verifySession()
    }

    // iOS restores a backgrounded app from the back/forward cache, which fires
    // pageshow rather than a useful visibilitychange - check there too.
    const handlePageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return
      hiddenSince = null
      void useAuthStore.getState().verifySession()
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pageshow', handlePageShow)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [])

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as { type: 'page' | 'journal'; name: string; viewingTasks?: boolean } | null
      if (state?.viewingTasks === true) {
        usePageStore.setState({ viewingTasks: true })
        return
      }
      if (state) {
        if (state.type === 'journal') {
          navigateToJournal(state.name, false)
        } else {
          navigateToPage(state.name, false)
        }
        // Ensure task manager is dismissed when navigating to a page/journal
        usePageStore.setState({ viewingTasks: false })
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

      // Ctrl/Cmd + K - Command palette (the single global entry; works even when
      // editing). Every other action is reachable from the palette. We use
      // Ctrl/Cmd combos, not Alt+Shift, because Alt+Shift+<letter> is Firefox's
      // accesskey/menu-mnemonic modifier and fires at the browser level, where
      // the page's preventDefault can't win.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyK') {
        e.preventDefault()
        openCommandPalette()
        return
      }

      // Ctrl + Shift + / - Toggle keyboard help (works even when editing)
      if (e.ctrlKey && e.shiftKey && e.code === 'Slash') {
        e.preventDefault()
        setKeyboardHelpOpen((prev) => !prev)
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [keyboardHelpOpen, sidebarMode, setSidebarMode, openCommandPalette])

  // Three-finger tap opens command palette (touch devices)
  useEffect(() => {
    const handleTouch = (e: TouchEvent) => {
      if (e.touches.length === 3) {
        e.preventDefault()
        openCommandPalette()
      }
    }
    window.addEventListener('touchstart', handleTouch, { passive: false })
    return () => window.removeEventListener('touchstart', handleTouch)
  }, [openCommandPalette])

  // Demo expiry modal
  if (isDemoMode && demoExpired) {
    return (
      <div className="flex items-center justify-center h-screen w-full bg-base-00 text-base-05">
        <div className="max-w-md mx-4 p-6 bg-base-01 border border-base-02 rounded-lg text-center">
          <svg
            className="w-12 h-12 mx-auto mb-4 text-base-0A"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
          <h1 className="text-xl font-semibold mb-2">Demo Session Expired</h1>
          <p className="text-base-04 mb-6">
            Your demo session has expired due to inactivity. Click below to start fresh with new demo content.
          </p>
          <button
            onClick={handleDemoReset}
            className="px-6 py-2 bg-base-0D text-base-00 rounded-lg hover:opacity-90 transition-opacity"
          >
            Start Fresh
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen w-full max-w-full overflow-hidden bg-base-00 text-base-05">
      {/* Demo mode banner - shows in demo mode */}
      {isDemoMode && <DemoBanner />}

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

      {/* Session expired - blocks the UI and offers a trip to the login page */}
      <SessionExpiredOverlay />

      {/* Draft recovery dialog */}
      <DraftRecoveryDialog />

      {/* Conflict resolution dialog */}
      <ConflictResolutionDialog />

      {/* Logseq import dialog (mounted only while open so its chunk lazy-loads) */}
      {importDialogOpen && (
        <Suspense fallback={null}>
          <LogseqImportDialog
            open={importDialogOpen}
            onOpenChange={(open) => !open && closeImportDialog()}
          />
        </Suspense>
      )}

      {/* Toast notifications */}
      <Toasts />

      {/* Demo welcome overlay - shows once per session */}
      {isDemoMode && <DemoWelcomeOverlay />}
    </div>
  )
}

export default App
