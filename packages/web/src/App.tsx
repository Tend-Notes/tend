// SPDX-License-Identifier: MIT WITH Commons-Clause
import { useEffect, useState } from 'react'
import { Sidebar, type SidebarMode } from './components/sidebar/Sidebar'
import { MainContent } from './components/layout/MainContent'
import { CommandPalette } from './components/command-palette/CommandPalette'
import { SearchPanel } from './components/search/SearchPanel'
import { KeyboardHelp } from './components/ui/KeyboardHelp'
import { DraftRecoveryDialog } from './components/ui/DraftRecoveryDialog'
import { usePageStore } from './stores/pageStore'
import { useUIStore } from './stores/uiStore'
import { useAutoCommit } from './hooks/useAutoCommit'

function App() {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [keyboardHelpOpen, setKeyboardHelpOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('navigation')
  const loadPages = usePageStore((state) => state.loadPages)
  const loadJournals = usePageStore((state) => state.loadJournals)
  const initializeFromUrl = usePageStore((state) => state.initializeFromUrl)
  const navigateToPage = usePageStore((state) => state.navigateToPage)
  const navigateToJournal = usePageStore((state) => state.navigateToJournal)
  const toggleSidebar = useUIStore((state) => state.toggleSidebar)
  const openSearch = useUIStore((state) => state.openSearch)

  // Initialize auto-commit system
  useAutoCommit()

  // Load initial data and handle URL
  useEffect(() => {
    loadPages()
    loadJournals()
    initializeFromUrl()
  }, [loadPages, loadJournals, initializeFromUrl])

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
        if (settingsOpen) {
          setSettingsOpen(false)
          e.preventDefault()
          return
        }
        if (sidebarMode !== 'navigation') {
          setSidebarMode('navigation')
          e.preventDefault()
          return
        }
      }

      // Shift + / (?) - Toggle keyboard help (works even when editing)
      if (e.shiftKey && e.key === '?') {
        e.preventDefault()
        setKeyboardHelpOpen((prev) => !prev)
        return
      }

      // Skip other shortcuts if we're editing
      if (isEditing) return

      // Alt + Shift + P - Command palette
      if (e.altKey && e.shiftKey && e.key === 'P') {
        e.preventDefault()
        setCommandPaletteOpen(true)
        return
      }

      // Alt + Shift + S - Toggle sidebar
      if (e.altKey && e.shiftKey && e.key === 'S') {
        e.preventDefault()
        toggleSidebar()
        return
      }

      // Alt + Shift + F - Search
      if (e.altKey && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        openSearch()
        return
      }

      // Alt + Shift + O - Settings
      if (e.altKey && e.shiftKey && e.key === 'O') {
        e.preventDefault()
        setSettingsOpen(true)
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [keyboardHelpOpen, settingsOpen, sidebarMode, toggleSidebar, openSearch])

  return (
    <div className="flex h-screen bg-base-00 text-base-05">
      {/* Sidebar */}
      <Sidebar
        mode={sidebarMode}
        onModeChange={setSidebarMode}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* Main content area */}
      <MainContent />

      {/* Command palette */}
      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
      />

      {/* Search panel */}
      <SearchPanel />

      {/* Keyboard help overlay */}
      <KeyboardHelp
        open={keyboardHelpOpen}
        onClose={() => setKeyboardHelpOpen(false)}
      />

      {/* Draft recovery dialog */}
      <DraftRecoveryDialog />

      {/* Settings placeholder - TODO: implement settings panel */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setSettingsOpen(false)} />
          <div className="relative z-10 bg-base-01 rounded-lg shadow-2xl border border-base-02 p-6 max-w-md w-full mx-4">
            <h2 className="text-lg font-medium text-base-06 mb-4">Settings</h2>
            <p className="text-sm text-base-04">Settings panel coming soon...</p>
            <button
              onClick={() => setSettingsOpen(false)}
              className="mt-4 px-3 py-1.5 text-sm bg-base-02 hover:bg-base-03 rounded transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
