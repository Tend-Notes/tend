// SPDX-License-Identifier: MIT WITH Commons-Clause
import { useEffect, useState, useRef, useCallback } from 'react'
import { usePageStore } from '../../stores/pageStore'
import { useSyncStatusStore } from '../../stores/syncStatusStore'
import { OutlinerEditor } from '../editor/OutlinerEditor'
import { TemplateEditor } from '../editor/TemplateEditor'
import { ImportErrorEditor } from '../editor/ImportErrorEditor'
import { BacklinksPanel } from '../panels/BacklinksPanel'
import { SaveStatus } from '../ui/SaveStatus'
import { HeatmapCalendar } from '../ui/HeatmapCalendar'
import { SelectionPill } from '../editor/SelectionPill'
import { TaskManagerPage } from '../tasks/TaskManagerPage'

export function MainContent() {
  const { currentPage, isLoading, initialized, error, editingTemplate, editingImportError } = usePageStore()
  const viewingTasks = usePageStore((s) => s.viewingTasks)
  const checkGitStatus = useSyncStatusStore((state) => state.checkGitStatus)
  const [showCalendar, setShowCalendar] = useState(false)

  // Scroll title visibility state
  const [showScrollTitle, setShowScrollTitle] = useState(false)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Track title visibility with IntersectionObserver
  useEffect(() => {
    const titleEl = titleRef.current
    const scrollContainer = scrollContainerRef.current
    if (!titleEl || !scrollContainer) return

    const observer = new IntersectionObserver(
      (entries) => {
        // Title is hidden when it's not intersecting (scrolled out of view)
        const isVisible = entries[0]?.isIntersecting ?? true
        setShowScrollTitle(!isVisible)
      },
      {
        root: scrollContainer,
        // Trigger when title is fully out of view (threshold 0)
        threshold: 0,
        // Small negative margin so title disappears just before it hits the top
        rootMargin: '-8px 0px 0px 0px',
      }
    )

    observer.observe(titleEl)
    return () => observer.disconnect()
  }, [currentPage?.name])

  // Reset scroll title when page changes
  const handlePageChange = useCallback(() => {
    setShowScrollTitle(false)
  }, [])

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

  if (isLoading || !initialized) {
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

  if (viewingTasks) {
    return <TaskManagerPage />
  }

  if (!currentPage) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <div className="text-base-03 text-sm">Select a page to begin</div>
      </main>
    )
  }

  // Render template editor when editing a template
  if (editingTemplate) {
    return (
      <main className="flex-1 flex flex-col overflow-hidden">
        <TemplateEditor
          contentTypeName={editingTemplate.contentTypeName}
          page={editingTemplate.page}
          hasUnsavedChanges={editingTemplate.hasUnsavedChanges}
        />
      </main>
    )
  }

  // Render import error editor when editing an import error
  if (editingImportError) {
    return (
      <main className="flex-1 flex flex-col overflow-hidden">
        <ImportErrorEditor
          errorName={editingImportError.errorName}
          originalName={editingImportError.originalName}
          error={editingImportError.error}
          timestamp={editingImportError.timestamp}
          page={editingImportError.page}
          fileName={editingImportError.fileName}
          hasUnsavedChanges={editingImportError.hasUnsavedChanges}
        />
      </main>
    )
  }

  return (
    <main className="flex-1 flex flex-col overflow-hidden relative">
      {/* Editor area with backlinks */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {/* Scroll title - appears when main title scrolls out of view */}
        {/* Must be inside scroll container for position: sticky to work */}
        <div
          className={`scroll-title ${showScrollTitle ? 'scroll-title--visible' : ''}`}
          aria-hidden={!showScrollTitle}
        >
          <span className="scroll-title-text">{currentPage.title}</span>
        </div>
        {/* Key changes with page name to trigger crossfade animation */}
        {/* Mobile-first: minimal padding on mobile, constrained width on md+ */}
        {/* pb-[50vh] provides bottom padding so typewriter scroll can center the last line */}
        <div key={currentPage.name} className="page-content px-2 py-3 pb-[50vh] md:max-w-2xl md:mx-auto md:px-6 md:pt-12 md:pb-[50vh]" onAnimationEnd={handlePageChange}>
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
              <h1 ref={titleRef} className="text-xl font-semibold text-base-06">{currentPage.title}</h1>
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

      <SelectionPill />
    </main>
  )
}
