// SPDX-License-Identifier: MIT WITH Commons-Clause
// Actions: Formatting layer for Seeds
//
// Loads and combines CodeMirror extensions for formatting.
// Seeds contain Actions; extensions plug into Actions.
//
// Actions is responsible for:
// - Loading formatting extensions
// - Combining them into a single extension array
//
// Extensions (markdown, delimiter hiding, etc.) are imported here.

import { useMemo, useCallback } from 'react'
import { Extension } from '@codemirror/state'
import { markdownExtension } from '../extensions/markdown'
import { hideDelimiters } from '../extensions/hideDelimiters'
import { wikilinkExtension } from '../extensions/wikilink'
import { formattingKeymap } from '../extensions/formatting'
import { taskStatus } from '../extensions/taskStatus'
import { tagExtension } from '../extensions/tags'
import { usePageStore } from '../../../stores/pageStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useTagStore } from '../../../stores/tagStore'

/**
 * Build href for a wikilink target.
 * Maps target to the correct URL path based on content type.
 *
 * URL structure:
 * - Journals: /journal/YYYY-MM-DD
 * - Pages: /page/name
 * - Custom content types: /content-type-dir/name (e.g., /person/John%20Smith)
 */
function buildWikilinkHref(target: string): string {
  // Journal links: journals/YYYY-MM-DD -> /journal/YYYY-MM-DD
  if (target.startsWith('journals/')) {
    const date = target.slice('journals/'.length)
    return `/journal/${encodeURIComponent(date)}`
  }

  // Check if this is a content type path (has a slash)
  const slashIndex = target.indexOf('/')
  if (slashIndex > 0) {
    // Content type path: person/John Smith -> /person/John%20Smith
    const encodedSegments = target.split('/').map(segment => encodeURIComponent(segment))
    return `/${encodedSegments.join('/')}`
  }

  // Plain page: name -> /page/name
  return `/page/${encodeURIComponent(target)}`
}

/**
 * Hook that returns CodeMirror extensions for formatting.
 * Called by Seed to get the extensions to load.
 */
export function useActions(): Extension[] {
  const navigateToPage = usePageStore((state) => state.navigateToPage)
  const navigateToJournal = usePageStore((state) => state.navigateToJournal)
  const taskStatusSet = useSettingsStore((state) => state.taskStatusSet)
  const getTagColors = useTagStore((state) => state.getTagColors)

  // Navigation callback for wikilinks (SPA navigation without full page reload)
  const handleWikilinkNavigate = useCallback((target: string) => {
    // Journal links: journals/YYYY-MM-DD
    if (target.startsWith('journals/')) {
      const date = target.slice('journals/'.length)
      navigateToJournal(date)
      return
    }

    // Everything else goes through navigateToPage
    // (handles both plain pages and content type paths)
    navigateToPage(target)
  }, [navigateToPage, navigateToJournal])

  return useMemo(() => {
    return [
      markdownExtension(),
      hideDelimiters(),
      wikilinkExtension({
        buildHref: buildWikilinkHref,
        onNavigate: handleWikilinkNavigate,
      }),
      formattingKeymap(),
      taskStatus(taskStatusSet),
      tagExtension({
        getColors: getTagColors,
        onNavigate: handleWikilinkNavigate,
      }),
    ]
  }, [handleWikilinkNavigate, taskStatusSet, getTagColors])
}
