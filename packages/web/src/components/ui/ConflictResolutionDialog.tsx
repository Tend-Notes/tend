// SPDX-License-Identifier: MIT WITH Commons-Clause
import { usePageStore } from '../../stores/pageStore'

export function ConflictResolutionDialog() {
  const pendingConflict = usePageStore((state) => state.pendingConflict)
  const currentPage = usePageStore((state) => state.currentPage)
  const resolveConflictKeepMine = usePageStore((state) => state.resolveConflictKeepMine)
  const resolveConflictKeepServer = usePageStore((state) => state.resolveConflictKeepServer)
  const dismissConflict = usePageStore((state) => state.dismissConflict)

  if (!pendingConflict || !currentPage) return null

  const pageName = currentPage.isJournal ? currentPage.journalDate : currentPage.name

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="overlay-backdrop fixed inset-0 bg-black/50 animate-fade-in" onClick={dismissConflict} />
      <div className="overlay-content relative bg-base-01 rounded-lg shadow-2xl border border-base-02 p-6 max-w-md w-full mx-4">
        <h2 className="text-lg font-medium text-base-08 mb-2">
          Version Conflict
        </h2>
        <p className="text-sm text-base-04 mb-4">
          The page "{pageName}" was modified by another session while you were editing.
          Your version ({currentPage.version}) is behind the server version ({pendingConflict.currentVersion}).
        </p>
        <p className="text-sm text-base-03 mb-6">
          Choose how to resolve this conflict:
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={resolveConflictKeepMine}
            className="px-4 py-2 text-sm bg-base-0D text-base-00 rounded hover:opacity-90 transition-opacity text-left"
          >
            <span className="font-medium">Keep my changes</span>
            <span className="block text-xs opacity-80 mt-0.5">
              Overwrite the server with your local edits
            </span>
          </button>
          <button
            onClick={resolveConflictKeepServer}
            className="px-4 py-2 text-sm bg-base-02 text-base-05 rounded hover:bg-base-03 transition-colors text-left"
          >
            <span className="font-medium">Keep server version</span>
            <span className="block text-xs opacity-80 mt-0.5">
              Discard your local changes and reload from server
            </span>
          </button>
          <button
            onClick={dismissConflict}
            className="px-4 py-2 text-sm text-base-04 hover:text-base-05 transition-colors"
          >
            Dismiss (keep editing, retry save later)
          </button>
        </div>
      </div>
    </div>
  )
}
