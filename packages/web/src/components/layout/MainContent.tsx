// SPDX-License-Identifier: MIT WITH Commons-Clause
import { useEffect } from 'react'
import { usePageStore } from '../../stores/pageStore'
import { useSyncStatusStore } from '../../stores/syncStatusStore'
import { OutlinerEditor } from '../editor/OutlinerEditor'
import { BacklinksPanel } from '../panels/BacklinksPanel'
import { ActivityLog } from '../ui/ActivityLog'
import { SaveStatus } from '../ui/SaveStatus'

export function MainContent() {
  const { currentPage, isLoading, error } = usePageStore()
  const checkGitStatus = useSyncStatusStore((state) => state.checkGitStatus)

  // Check git status when page changes
  useEffect(() => {
    if (currentPage) {
      const filePath = currentPage.isJournal
        ? `journals/${currentPage.journalDate}.md`
        : `pages/${currentPage.name}.md`
      checkGitStatus(filePath)
    }
  }, [currentPage?.name, currentPage?.isJournal, checkGitStatus])

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
            <h1 className="text-xl font-semibold text-base-06">{currentPage.title}</h1>
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
