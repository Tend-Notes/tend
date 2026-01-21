// SPDX-License-Identifier: MIT WITH Commons-Clause
import { useEffect, useState } from 'react'
import { Sidebar } from './components/sidebar/Sidebar'
import { MainContent } from './components/layout/MainContent'
import { CommandPalette } from './components/command-palette/CommandPalette'
import { SearchPanel } from './components/search/SearchPanel'
import { KeyboardHelp } from './components/ui/KeyboardHelp'
import { DraftRecoveryDialog } from './components/ui/DraftRecoveryDialog'
import { ConflictResolutionDialog } from './components/ui/ConflictResolutionDialog'
import { usePageStore } from './stores/pageStore'
import { useUIStore } from './stores/uiStore'
import { useAutoCommit } from './hooks/useAutoCommit'
import { useWebSocket } from './hooks/useWebSocket'
import { useTheme } from './hooks/useTheme'

function App() {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [keyboardHelpOpen, setKeyboardHelpOpen] = useState(false)
  const sidebarMode = useUIStore((state) => state.sidebarMode)
  const setSidebarMode = useUIStore((state) => state.setSidebarMode)
  const loadPages = usePageStore((state) => state.loadPages)
  const loadJournals = usePageStore((state) => state.loadJournals)
  const initializeFromUrl = usePageStore((state) => state.initializeFromUrl)
  const navigateToPage = usePageStore((state) => state.navigateToPage)
  const navigateToJournal = usePageStore((state) => state.navigateToJournal)
  const toggleSidebar = useUIStore((state) => state.toggleSidebar)
  const openSearch = useUIStore((state) => state.openSearch)

  // Initialize auto-commit system
  useAutoCommit()

  // Initialize WebSocket connection for real-time updates
  useWebSocket()

  // Apply theme based on user settings
  useTheme()

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

      // Skip other shortcuts if we're editing
      if (isEditing) return

      // Alt + Shift + P - Command palette
      // Use e.code for physical key (macOS Alt produces special characters with e.key)
      if (e.altKey && e.shiftKey && e.code === 'KeyP') {
        e.preventDefault()
        setCommandPaletteOpen(true)
        return
      }

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
  }, [keyboardHelpOpen, sidebarMode, toggleSidebar, openSearch])

  return (
    <div className="flex h-screen bg-base-00 text-base-05">
      {/* Sidebar */}
      <Sidebar
        mode={sidebarMode}
        onModeChange={setSidebarMode}
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

      {/* Conflict resolution dialog */}
      <ConflictResolutionDialog />
    </div>
  )
}

export default App
