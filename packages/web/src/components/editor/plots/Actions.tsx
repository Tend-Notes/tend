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
import { usePageStore } from '../../../stores/pageStore'

/**
 * Hook that returns CodeMirror extensions for formatting.
 * Called by Seed to get the extensions to load.
 */
export function useActions(): Extension[] {
  const navigateToPage = usePageStore((s) => s.navigateToPage)
  const navigateToJournal = usePageStore((s) => s.navigateToJournal)

  // Handle wikilink navigation
  const handleWikilinkNavigate = useCallback((target: string) => {
    // Check if it's a journal link (journals/YYYY-MM-DD)
    if (target.startsWith('journals/')) {
      const date = target.slice('journals/'.length)
      navigateToJournal(date)
    } else {
      // Regular page or content type path
      navigateToPage(target)
    }
  }, [navigateToPage, navigateToJournal])

  return useMemo(() => {
    return [
      markdownExtension(),
      hideDelimiters(),
      wikilinkExtension(handleWikilinkNavigate),
    ]
  }, [handleWikilinkNavigate])
}
