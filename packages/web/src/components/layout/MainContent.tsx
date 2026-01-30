// SPDX-License-Identifier: MIT WITH Commons-Clause
import { useEffect, useState } from 'react'
import { usePageStore } from '../../stores/pageStore'
import { useSyncStatusStore } from '../../stores/syncStatusStore'
import { useUIStore } from '../../stores/uiStore'
import { OutlinerEditor } from '../editor/OutlinerEditor'
import { BacklinksPanel } from '../panels/BacklinksPanel'
import { ActivityLog } from '../ui/ActivityLog'
import { SaveStatus } from '../ui/SaveStatus'
import { HeatmapCalendar } from '../ui/HeatmapCalendar'
import { RadialMenu } from '../ui/RadialMenu'

// Find the currently focused editor element
function findActiveEditor(): HTMLElement | null {
  const focusedEditor = document.querySelector('[data-seed-editor]:focus-within') ||
    document.activeElement?.closest('[data-seed-editor]')

  if (focusedEditor) {
    return focusedEditor as HTMLElement
  }

  // Fall back to last focused block
  const lastFocusedUuid = useUIStore.getState().lastFocusedBlockUuid
  if (lastFocusedUuid) {
    const blockEl = document.querySelector(`[data-block-id="${lastFocusedUuid}"]`)
    return blockEl?.querySelector('[data-seed-editor]') as HTMLElement | null
  }

  return null
}

// Apply formatting to the currently focused editor
function applyFormatting(delimiter: string) {
  const editor = findActiveEditor()
  if (!editor) return

  const event = new CustomEvent('seed-format', {
    detail: { delimiter },
    bubbles: false,
  })
  editor.dispatchEvent(event)
}

// Dispatch boundary event for tab/shift-tab
function dispatchBoundaryEvent(eventType: 'tab' | 'shift-tab') {
  const editor = findActiveEditor()
  if (!editor) return

  const event = new CustomEvent('seed-boundary', {
    detail: { type: eventType },
    bubbles: false,
  })
  editor.dispatchEvent(event)
}

// Check if device is mobile/touch
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const check = () => {
      const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
      const isNarrowScreen = window.innerWidth < 768
      setIsMobile(isTouchDevice || isNarrowScreen)
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  return isMobile
}

export function MainContent() {
  const { currentPage, isLoading, error } = usePageStore()
  const checkGitStatus = useSyncStatusStore((state) => state.checkGitStatus)
  const [showCalendar, setShowCalendar] = useState(false)
  const isMobile = useIsMobile()
  const openSearch = useUIStore((state) => state.openSearch)

  // Radial menu items for mobile
  const radialMenuItems = [
    {
      id: 'bold',
      label: 'Bold',
      icon: <span className="font-bold text-sm">B</span>,
      onClick: () => applyFormatting('**'),
    },
    {
      id: 'italic',
      label: 'Italic',
      icon: <span className="italic text-sm">I</span>,
      onClick: () => applyFormatting('*'),
    },
    {
      id: 'highlight',
      label: 'Highlight',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
      ),
      onClick: () => applyFormatting('=='),
    },
    {
      id: 'strikethrough',
      label: 'Strikethrough',
      icon: <span className="line-through text-sm">S</span>,
      onClick: () => applyFormatting('~~'),
    },
    {
      id: 'indent',
      label: 'Indent',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5v14" />
        </svg>
      ),
      onClick: () => dispatchBoundaryEvent('tab'),
    },
    {
      id: 'outdent',
      label: 'Outdent',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14V5" />
        </svg>
      ),
      onClick: () => dispatchBoundaryEvent('shift-tab'),
    },
    {
      id: 'search',
      label: 'Search',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      ),
      onClick: openSearch,
    },
  ]

  // Check git status when page changes
  useEffect(() => {
    if (currentPage) {
      const filePath = currentPage.isJournal
        ? `journals/${currentPage.journalDate}.md`
        : `pages/${currentPage.name}.md`
      checkGitStatus(filePath)
    }
  }, [currentPage?.name, currentPage?.isJournal, checkGitStatus])

  // Close calendar when page changes
  useEffect(() => {
    setShowCalendar(false)
  }, [currentPage?.name])

  if (isLoading) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <div className="text-base-03 text-sm">Loading...</div>
      </main>
    )
  }

  if (error) {
    return (
      <main className="flex-1 flex items-center justify-center bg-base-00">
        <div className="text-center p-4">
          <div className="text-base-08 text-sm mb-4">{error}</div>
          <button
            onClick={() => {
              // Clear error and retry loading
              usePageStore.getState().setError(null)
              usePageStore.getState().initializeFromUrl()
            }}
            className="px-4 py-2 bg-base-02 hover:bg-base-03 text-base-05 rounded text-sm transition-colors"
          >
            Retry
          </button>
        </div>
      </main>
    )
  }

  if (!currentPage) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <div className="text-base-03 text-sm">Select a page to begin</div>
      </main>
    )
  }

  return (
    <main className="flex-1 flex flex-col overflow-hidden">
      {/* Editor area with backlinks */}
      <div className="flex-1 overflow-y-auto">
        {/* Key changes with page name to trigger crossfade animation */}
        {/* Mobile-first: minimal padding on mobile, constrained width on md+ */}
        <div key={currentPage.name} className="page-content px-2 py-3 pb-24 md:max-w-2xl md:mx-auto md:px-6 md:py-12 md:pb-12">
          {/* Page title with save status */}
          <div className="flex items-center gap-3 mb-8">
            <div className="relative flex items-center gap-2">
              {/* Calendar icon for journal pages - placed before title */}
              {currentPage.isJournal && (
                <button
                  onClick={() => setShowCalendar(!showCalendar)}
                  className="p-1 text-base-04 hover:text-base-05 transition-colors"
                  title="Open calendar"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </button>
              )}
              <h1 className="text-xl font-semibold text-base-06">{currentPage.title}</h1>
              {/* Heatmap calendar popover */}
              {showCalendar && currentPage.isJournal && (
                <HeatmapCalendar
                  onClose={() => setShowCalendar(false)}
                  currentDate={currentPage.journalDate || undefined}
                />
              )}
            </div>
            <SaveStatus />
          </div>

          {/* Editor */}
          <OutlinerEditor page={currentPage} readonly={currentPage.properties.readonly === 'true'} />

          {/* Backlinks panel - only show for non-journal pages */}
          {!currentPage.isJournal && (
            <BacklinksPanel pageName={currentPage.name} />
          )}
        </div>
      </div>

      {/* Activity log at the bottom - desktop only */}
      {!isMobile && <ActivityLog />}

      {/* Radial menu for mobile - experimental alternative to bottom toolbar */}
      {isMobile && <RadialMenu items={radialMenuItems} />}
    </main>
  )
}
