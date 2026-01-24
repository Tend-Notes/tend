// SPDX-License-Identifier: MIT WITH Commons-Clause
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { usePageStore } from '../../stores/pageStore'
import { useUIStore, type SidebarMode } from '../../stores/uiStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useRecentSheetsStore } from '../../stores/recentSheetsStore'
import { useTagStore } from '../../stores/tagStore'
import { SidebarOptions } from './SidebarOptions'
import { SidebarTags } from './SidebarTags'
import { SidebarTodos } from './SidebarTodos'

// Lazy load heavy sidebar panels
const SidebarGraph = lazy(() => import('./SidebarGraph'))
const SidebarHistory = lazy(() => import('./SidebarHistory'))

// Loading fallback for lazy-loaded sidebar panels
function SidebarLoading() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-sm text-base-04">Loading...</div>
    </div>
  )
}

// Re-export the type for backwards compatibility
export type { SidebarMode }

// Resize constraints
const MIN_WIDTH = 279
const getMaxWidth = () => (typeof window !== 'undefined' ? window.innerWidth * 0.4 : 500)

// Mobile breakpoint
const MOBILE_BREAKPOINT = 768

interface SidebarProps {
  mode: SidebarMode
  onModeChange: (mode: SidebarMode) => void
}

export function Sidebar({ mode, onModeChange }: SidebarProps) {
  const { currentPageName, currentPage, navigateToPage, navigateToJournal, loadTodaysJournal } =
    usePageStore()
  const { sidebarOpen, sidebarWidth, setSidebarWidth, toggleSidebar } = useUIStore()
  const { contentTypes } = useSettingsStore()
  const { recentSheets, recentTags } = useRecentSheetsStore()
  const getTagColor = useTagStore((state) => state.getTagColor)

  // Visual width during drag (can exceed bounds for bounceback effect)
  const [visualWidth, setVisualWidth] = useState(sidebarWidth)
  const [isResizing, setIsResizing] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Sync visual width with store when not resizing
  useEffect(() => {
    if (!isResizing) {
      setVisualWidth(sidebarWidth)
    }
  }, [sidebarWidth, isResizing])

  // Handle resize with elastic overextension
  const handleResize = useCallback((deltaX: number) => {
    setIsResizing(true)
    setVisualWidth((prev) => {
      const newWidth = prev + deltaX
      const maxWidth = getMaxWidth()

      // Allow overextension with resistance (rubber band effect)
      if (newWidth < MIN_WIDTH) {
        // Resistance when pulling smaller than min
        const overextension = MIN_WIDTH - newWidth
        return MIN_WIDTH - overextension * 0.3
      } else if (newWidth > maxWidth) {
        // Resistance when pushing larger than max
        const overextension = newWidth - maxWidth
        return maxWidth + overextension * 0.3
      }

      return newWidth
    })
  }, [])

  // Snap back to valid range on release
  const handleResizeEnd = useCallback(() => {
    const maxWidth = getMaxWidth()
    const clampedWidth = Math.max(MIN_WIDTH, Math.min(maxWidth, visualWidth))
    setSidebarWidth(clampedWidth)
    setIsResizing(false)
  }, [visualWidth, setSidebarWidth])

  // Get current page info for history
  const isCurrentJournal = currentPage?.isJournal ?? false

  // Render content based on mode
  const renderContent = () => {
    switch (mode) {
      case 'history':
        return (
          <Suspense fallback={<SidebarLoading />}>
            <SidebarHistory
              onBack={() => onModeChange('navigation')}
              pageName={currentPageName}
              isJournal={isCurrentJournal}
            />
          </Suspense>
        )

      case 'graph':
        return (
          <Suspense fallback={<SidebarLoading />}>
            <SidebarGraph onBack={() => onModeChange('navigation')} />
          </Suspense>
        )

      case 'options':
        return (
          <SidebarOptions onBack={() => onModeChange('navigation')} />
        )

      case 'tags':
        return (
          <SidebarTags onBack={() => onModeChange('navigation')} />
        )

      case 'todos':
        return (
          <SidebarTodos onBack={() => onModeChange('navigation')} />
        )

      default:
        return (
          <>
            {/* Header with collapse button */}
            <div className="flex items-center justify-between p-3">
              <button
                onClick={() => loadTodaysJournal()}
                className="px-2 py-1 text-sm text-base-04 hover:text-base-05 transition-colors"
              >
                Today
              </button>
              <button
                onClick={toggleSidebar}
                className="p-1 text-base-03 hover:text-base-05 transition-colors"
                title="Close sidebar (Alt+Shift+S)"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7M19 19l-7-7 7-7" />
                </svg>
              </button>
            </div>

            {/* Navigation - shows recently accessed sheets per content type */}
            <div className="flex-1 overflow-y-auto px-3">
              {contentTypes.map((ct) => {
                const ctSheets = recentSheets[ct.id] || []
                if (ctSheets.length === 0) return null

                return (
                  <div key={ct.id} className="mb-4">
                    <h2 className="px-2 py-1 text-xs text-base-03 uppercase tracking-wide">
                      {ct.name}
                    </h2>
                    <ul>
                      {ctSheets.map((sheet) => {
                        // Build navigation path based on content type
                        let navPath: string
                        let navAction: () => void

                        if (ct.id === 'journal') {
                          // Journals use navigateToJournal with date
                          navPath = sheet.name
                          navAction = () => navigateToJournal(sheet.journalDate!)
                        } else if (ct.id === 'page') {
                          // Pages use navigateToPage with just the name
                          navPath = sheet.name
                          navAction = () => navigateToPage(sheet.name)
                        } else {
                          // Custom content types: directory/date/name for saveByDate, directory/name otherwise
                          navPath = ct.saveByDate && sheet.journalDate
                            ? `${ct.directory}/${sheet.journalDate}/${sheet.name}`
                            : `${ct.directory}/${sheet.name}`
                          navAction = () => navigateToPage(navPath)
                        }

                        return (
                          <li key={navPath}>
                            <button
                              onClick={navAction}
                              className={`w-full px-2 py-1 text-left text-sm transition-colors ${
                                currentPageName === navPath || currentPageName === sheet.name
                                  ? 'text-base-06'
                                  : 'text-base-04 hover:text-base-05'
                              }`}
                            >
                              {sheet.title}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )
              })}

              {/* Tags section */}
              {recentTags.length > 0 && (
                <div className="mb-4">
                  <h2 className="px-2 py-1 text-xs text-base-03 uppercase tracking-wide">
                    Tags
                  </h2>
                  <ul>
                    {recentTags.map((tag) => {
                      const tagPath = `tags/${tag.name}`
                      const tagColor = getTagColor(tag.name)
                      const isActive = currentPageName === tagPath
                      return (
                        <li key={tag.name} className="px-2 py-1">
                          <button
                            onClick={() => navigateToPage(tagPath)}
                            className="tag-pill text-sm"
                            style={{
                              '--tag-color': tagColor,
                              opacity: isActive ? 1 : 0.8,
                            } as React.CSSProperties}
                          >
                            #{tag.name}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </div>
          </>
        )
    }
  }

  // Width: use visualWidth during resize (for bounceback), otherwise sidebarWidth
  const displayWidth = isResizing ? visualWidth : sidebarWidth
  const currentWidth = sidebarOpen ? displayWidth : 32

  // On mobile, sidebar is a full-screen overlay when open, completely hidden when closed
  if (isMobile) {
    if (!sidebarOpen) {
      return null // No collapsed state on mobile - use toolbar to open
    }

    return (
      <aside
        className="fixed inset-0 z-50 flex flex-col overflow-hidden"
        style={{ backgroundColor: 'var(--sidebar-bg)' }}
      >
        <div className="sidebar-content flex-1 flex flex-col overflow-hidden relative">
          <div key={mode} className="sidebar-mode-content flex-1 flex flex-col overflow-hidden relative">
            {renderContent()}
          </div>
        </div>

        {/* Bottom toolbar - same as desktop but with close button */}
        <div className="flex justify-between items-center p-3 border-t border-base-02 safe-area-bottom">
          <button
            onClick={toggleSidebar}
            className="p-3 rounded-lg text-base-04 hover:text-base-05 transition-colors"
            title="Close sidebar"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => onModeChange(mode === 'todos' ? 'navigation' : 'todos')}
              className={`p-3 rounded-lg transition-colors ${
                mode === 'todos' ? 'text-base-06 bg-base-02' : 'text-base-04 hover:text-base-05'
              }`}
              title="Tasks"
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </button>
            <button
              onClick={() => onModeChange(mode === 'tags' ? 'navigation' : 'tags')}
              className={`p-3 rounded-lg transition-colors ${
                mode === 'tags' ? 'text-base-06 bg-base-02' : 'text-base-04 hover:text-base-05'
              }`}
              title="Tags"
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
              </svg>
            </button>
            <button
              onClick={() => onModeChange(mode === 'graph' ? 'navigation' : 'graph')}
              className={`p-3 rounded-lg transition-colors ${
                mode === 'graph' ? 'text-base-06 bg-base-02' : 'text-base-04 hover:text-base-05'
              }`}
              title="Graph view"
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <circle cx="12" cy="12" r="3" />
                <line x1="12" y1="12" x2="12" y2="3" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="12" cy="3" r="2" />
                <line x1="12" y1="12" x2="20" y2="8" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="20" cy="8" r="2" />
                <line x1="12" y1="12" x2="19" y2="17" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="19" cy="17" r="2" />
                <line x1="12" y1="12" x2="5" y2="18" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="5" cy="18" r="2" />
                <line x1="12" y1="12" x2="4" y2="9" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="4" cy="9" r="2" />
              </svg>
            </button>
            <button
              onClick={() => onModeChange(mode === 'history' ? 'navigation' : 'history')}
              className={`p-3 rounded-lg transition-colors ${
                mode === 'history' ? 'text-base-06 bg-base-02' : 'text-base-04 hover:text-base-05'
              }`}
              title="History"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v5h5" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l4 2" />
              </svg>
            </button>
            <button
              onClick={() => onModeChange(mode === 'options' ? 'navigation' : 'options')}
              className={`p-3 rounded-lg transition-colors ${
                mode === 'options' ? 'text-base-06 bg-base-02' : 'text-base-04 hover:text-base-05'
              }`}
              title="Options"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
            </button>
          </div>
        </div>
      </aside>
    )
  }

  // Desktop layout
  return (
    <aside
      className="sidebar relative flex flex-col overflow-hidden"
      style={{
        width: currentWidth,
        backgroundColor: 'var(--sidebar-bg)',
        // Smooth spring animation when snapping back from overextension
        transition: isResizing ? 'none' : 'width 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}
    >
      {/* Collapsed state: just show toggle button */}
      {!sidebarOpen ? (
        <div className="flex flex-col items-center py-3">
          <button
            onClick={toggleSidebar}
            className="p-1 text-base-03 hover:text-base-05 transition-colors"
            title="Open sidebar (Alt+Shift+S)"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      ) : (
        <>
          <div className="sidebar-content flex-1 flex flex-col overflow-hidden relative">
            {/* Key changes with mode to trigger animation */}
            <div key={mode} className="sidebar-mode-content flex-1 flex flex-col overflow-hidden relative">
              {renderContent()}
            </div>
          </div>

          {/* Bottom toolbar: Tasks, Tags, Graph, History, Options - always visible when open */}
          <div className="flex justify-end gap-1 p-[10px] border-t border-base-02">
            <button
              onClick={() => onModeChange(mode === 'todos' ? 'navigation' : 'todos')}
              className={`p-2 rounded-lg transition-colors ${
                mode === 'todos' ? 'text-base-06 bg-base-02' : 'text-base-04 hover:text-base-05'
              }`}
              style={{ boxShadow: 'inset 0 0 0 1px var(--base02)' }}
              title="Tasks"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </button>
            <button
              onClick={() => onModeChange(mode === 'tags' ? 'navigation' : 'tags')}
              className={`p-2 rounded-lg transition-colors ${
                mode === 'tags' ? 'text-base-06 bg-base-02' : 'text-base-04 hover:text-base-05'
              }`}
              style={{ boxShadow: 'inset 0 0 0 1px var(--base02)' }}
              title="Tags"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
              </svg>
            </button>
            <button
              onClick={() => onModeChange(mode === 'graph' ? 'navigation' : 'graph')}
              className={`p-2 rounded-lg transition-colors ${
                mode === 'graph' ? 'text-base-06 bg-base-02' : 'text-base-04 hover:text-base-05'
              }`}
              style={{ boxShadow: 'inset 0 0 0 1px var(--base02)' }}
              title="Graph view"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                {/* Central node */}
                <circle cx="12" cy="12" r="3" />
                {/* Radiating lines and outer nodes */}
                <line x1="12" y1="12" x2="12" y2="3" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="12" cy="3" r="2" />
                <line x1="12" y1="12" x2="20" y2="8" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="20" cy="8" r="2" />
                <line x1="12" y1="12" x2="19" y2="17" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="19" cy="17" r="2" />
                <line x1="12" y1="12" x2="5" y2="18" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="5" cy="18" r="2" />
                <line x1="12" y1="12" x2="4" y2="9" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="4" cy="9" r="2" />
              </svg>
            </button>
            <button
              onClick={() => onModeChange(mode === 'history' ? 'navigation' : 'history')}
              className={`p-2 rounded-lg transition-colors ${
                mode === 'history' ? 'text-base-06 bg-base-02' : 'text-base-04 hover:text-base-05'
              }`}
              style={{ boxShadow: 'inset 0 0 0 1px var(--base02)' }}
              title="History"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v5h5" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l4 2" />
              </svg>
            </button>
            <button
              onClick={() => onModeChange(mode === 'options' ? 'navigation' : 'options')}
              className={`p-2 rounded-lg transition-colors ${
                mode === 'options' ? 'text-base-06 bg-base-02' : 'text-base-04 hover:text-base-05'
              }`}
              style={{ boxShadow: 'inset 0 0 0 1px var(--base02)' }}
              title="Options (Alt+Shift+O)"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
            </button>
          </div>

          {/* Resize handle on right edge */}
          <ResizeHandle onResize={handleResize} onResizeEnd={handleResizeEnd} />
        </>
      )}
    </aside>
  )
}

// Resize handle component with drag pill
function ResizeHandle({
  onResize,
  onResizeEnd,
}: {
  onResize: (deltaX: number) => void
  onResizeEnd: () => void
}) {
  const [isDragging, setIsDragging] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const startXRef = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    startXRef.current = e.clientX
  }, [])

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startXRef.current
      startXRef.current = e.clientX
      onResize(deltaX)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      onResizeEnd()
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    // Change cursor globally while dragging
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isDragging, onResize, onResizeEnd])

  return (
    <div
      className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize flex items-center justify-center group"
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Drag pill - always visible but subtle, more prominent on hover/drag */}
      <div
        className={`
          w-1 h-12 rounded-full
          transition-all duration-150 ease-out
          ${isDragging ? 'bg-base-05 scale-y-110' : isHovered ? 'bg-base-04' : 'bg-base-02'}
        `}
      />
    </div>
  )
}

// Re-export for use elsewhere if needed
export type { SidebarProps }
