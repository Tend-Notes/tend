// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Making a garden the active one.
//
// Opening a different garden means dropping everything held about the last one
// and loading the new one's content types and default page. That sequence was
// written out twice in the gardens UI — once for a switch, once for an unlock —
// and a local garden needs a third copy of it, which is reason enough to have
// it in one place.
//
// The order matters and is not arbitrary:
//
//   1. The sheet-list cache is invalidated, so nothing serves the old garden's
//      listing.
//   2. Every store holding garden content is reset.
//   3. The URL is put back to home BEFORE anything loads. A stale
//      /page/<name> from the previous garden would 404 in the new one and get
//      auto-created there, which leaks a page name across gardens.
//   4. The new garden's content types are loaded, then its default page.

import { contentTypes as contentTypesApi } from '../lib/api'
import { invalidateSheetList } from '../lib/sheetListCache'
import { usePageStore } from './pageStore'
import { useRecentSheetsStore } from './recentSheetsStore'
import { useSettingsStore } from './settingsStore'
import { useSyncStatusStore } from './syncStatusStore'
import { useUIStore } from './uiStore'

/**
 * Drop everything held about the garden that was open.
 *
 * Separate from the loading half because locking a garden does this and stops:
 * there is nothing to load until it is unlocked again.
 */
export function clearGardenState(): void {
  invalidateSheetList()
  usePageStore.getState().reset()
  useUIStore.getState().reset()
  useSyncStatusStore.getState().reset()
  useRecentSheetsStore.getState().reset()
}

/**
 * Open a garden that is already selected on whichever backend serves it.
 *
 * The caller has done the backend-specific part first — the server's
 * `/gardens/switch`, or a local garden's session — and this is the part that is
 * the same either way.
 */
export async function activateGarden(): Promise<void> {
  clearGardenState()

  // Home before loading: see the note above about auto-creating a page from
  // the previous garden's URL.
  window.history.replaceState(null, '', '/')

  const types = await contentTypesApi.list()
  useSettingsStore.getState().setContentTypes(types)
  await usePageStore.getState().initializeFromUrl()
}
