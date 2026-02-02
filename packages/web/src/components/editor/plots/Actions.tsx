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
import { cursorMarkerExtension } from '../extensions/cursorMarker'
import { blockReferenceExtension } from '../extensions/blockReference'
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
  const editingTemplate = usePageStore((state) => state.editingTemplate)
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

  // Navigation callback for block references
  // Navigates to the page containing the block and scrolls to the block
  const handleBlockRefNavigate = useCallback((pageName: string, _blockUuid: string) => {
    // Navigate to the page
    // After navigation, the app will scroll to the block UUID via URL hash
    // For now, just navigate to the page - scroll-to-block can be added later

    // Check if this is a journal date (YYYY-MM-DD format)
    // The block API returns just the date for journals, not "journals/YYYY-MM-DD"
    if (/^\d{4}-\d{2}-\d{2}$/.test(pageName)) {
      navigateToJournal(pageName)
      return
    }

    // Everything else: pages and sheets (directory/name paths)
    // navigateToPage handles both regular pages and content type paths
    navigateToPage(pageName)
    // TODO: Add scroll-to-block logic using _blockUuid
    // This could be done via URL hash (#blockUuid) or a separate mechanism
  }, [navigateToPage, navigateToJournal])

  // Check if we're in template editing mode
  const isTemplateEditing = editingTemplate !== null

  return useMemo(() => {
    const extensions = [
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
      blockReferenceExtension({
        onNavigate: handleBlockRefNavigate,
      }),
    ]

    // Add cursor marker highlighting when editing templates
    if (isTemplateEditing) {
      extensions.push(cursorMarkerExtension())
    }

    return extensions
  }, [handleWikilinkNavigate, handleBlockRefNavigate, taskStatusSet, getTagColors, isTemplateEditing])
}
