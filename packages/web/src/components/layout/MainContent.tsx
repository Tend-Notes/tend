// SPDX-License-Identifier: MIT WITH Commons-Clause
import { usePageStore } from '../../stores/pageStore'
import { OutlinerEditor } from '../editor/OutlinerEditor'
import { BacklinksPanel } from '../panels/BacklinksPanel'

export function MainContent() {
  const { currentPage, isLoading, error } = usePageStore()

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
        <div className="max-w-2xl mx-auto px-6 py-12">
          {/* Page title */}
          <h1 className="text-xl font-semibold text-base-06 mb-8">{currentPage.title}</h1>

          {/* Editor */}
          <OutlinerEditor page={currentPage} />

          {/* Backlinks panel - only show for non-journal pages */}
          {!currentPage.isJournal && (
            <BacklinksPanel pageName={currentPage.name} />
          )}
        </div>
      </div>
    </main>
  )
}
