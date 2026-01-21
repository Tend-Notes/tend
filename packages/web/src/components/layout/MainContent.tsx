// SPDX-License-Identifier: MIT WITH Commons-Clause
import { useEffect, useState } from 'react'
import { usePageStore } from '../../stores/pageStore'
import { useSyncStatusStore } from '../../stores/syncStatusStore'
import { OutlinerEditor } from '../editor/OutlinerEditor'
import { BacklinksPanel } from '../panels/BacklinksPanel'
import { ActivityLog } from '../ui/ActivityLog'
import { SaveStatus } from '../ui/SaveStatus'
import { HeatmapCalendar } from '../ui/HeatmapCalendar'

export function MainContent() {
  const { currentPage, isLoading, error } = usePageStore()
  const checkGitStatus = useSyncStatusStore((state) => state.checkGitStatus)
  const [showCalendar, setShowCalendar] = useState(false)

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
      <main className="flex-1 flex items-center justify-center">
        <div className="text-base-08 text-sm">{error}</div>
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
        <div key={currentPage.name} className="page-content max-w-2xl mx-auto px-6 py-12">
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

      {/* Activity log at the bottom */}
      <ActivityLog />
    </main>
  )
}
