// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Reloading what is on screen when the garden folder changes outside Tend.
//
// The server counterpart of this is the WebSocket's `file_changed`, and this
// deliberately behaves the same way: the open page is re-fetched in the
// background — no loading blank-out, no view change — and only when there is
// nothing unsaved to lose. `shouldSkipFileWatcherReload` is the same guard the
// WebSocket path uses, covering unsaved edits, a pending debounced save, and
// the grace period just after a save.
//
// The one case with no server equivalent: the browser may report that it
// *missed* events, at which point nothing about the folder can be assumed. The
// backend has already dropped its scan by the time this hears about it, so the
// open page is reloaded unconditionally.

import { useEffect } from 'react'
import { shouldSkipFileWatcherReload, usePageStore } from '../stores/pageStore'
import { invalidateSheetList } from '../lib/sheetListCache'
import { useLocalGardenStore } from '../stores/localGardenStore'

export function useLocalFolderWatch(): void {
  const localGardenOpen = useLocalGardenStore((state) => state.openId !== null)

  useEffect(() => {
    if (!localGardenOpen) return

    let unsubscribe: (() => void) | null = null
    let cancelled = false

    void import('../lib/local/localBackend').then(({ onFolderChange }) => {
      if (cancelled) return

      unsubscribe = onFolderChange((paths) => {
        // The listing has changed whatever else did: a file may have appeared
        // or gone.
        invalidateSheetList()

        const { currentPageName, currentPage, navigateToPage, navigateToJournal } =
          usePageStore.getState()
        if (!currentPageName) return

        // An empty list means events were missed, so the open page is reloaded
        // regardless of which files were named.
        const missedEvents = paths.length === 0
        if (!missedEvents && shouldSkipFileWatcherReload()) return

        // Background: no errors, no blank-out, and no view change — a note
        // reloading must not bounce the user somewhere else.
        const reload = currentPage?.isJournal
          ? navigateToJournal(currentPageName, false, { background: true })
          : navigateToPage(currentPageName, false, { background: true })
        reload.catch(() => {})
      })
    })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [localGardenOpen])
}
