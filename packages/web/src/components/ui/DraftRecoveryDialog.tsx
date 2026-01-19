// SPDX-License-Identifier: MIT WITH Commons-Clause
import { usePageStore } from '../../stores/pageStore'

export function DraftRecoveryDialog() {
  const pendingDraftRecovery = usePageStore((state) => state.pendingDraftRecovery)
  const restoreDraft = usePageStore((state) => state.restoreDraft)
  const discardDraft = usePageStore((state) => state.discardDraft)

  if (!pendingDraftRecovery) return null

  const savedAt = new Date(pendingDraftRecovery.savedAt)
  const timeAgo = formatTimeAgo(savedAt)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="overlay-backdrop fixed inset-0 bg-black/50 animate-fade-in" />
      <div className="overlay-content relative bg-base-01 rounded-lg shadow-2xl border border-base-02 p-6 max-w-md w-full mx-4">
        <h2 className="text-lg font-medium text-base-06 mb-2">
          Recover unsaved changes?
        </h2>
        <p className="text-sm text-base-04 mb-4">
          Found unsaved changes from {timeAgo}. These changes were not saved to the server.
        </p>
        <p className="text-sm text-base-03 mb-6">
          {pendingDraftRecovery.blocks.length} blocks in draft
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={discardDraft}
            className="px-4 py-2 text-sm text-base-04 hover:text-base-05 transition-colors"
          >
            Discard
          </button>
          <button
            onClick={restoreDraft}
            className="px-4 py-2 text-sm bg-base-0D text-base-00 rounded hover:opacity-90 transition-opacity"
          >
            Restore
          </button>
        </div>
      </div>
    </div>
  )
}

function formatTimeAgo(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffDay > 0) {
    return diffDay === 1 ? 'yesterday' : `${diffDay} days ago`
  }
  if (diffHour > 0) {
    return diffHour === 1 ? '1 hour ago' : `${diffHour} hours ago`
  }
  if (diffMin > 0) {
    return diffMin === 1 ? '1 minute ago' : `${diffMin} minutes ago`
  }
  return 'just now'
}
