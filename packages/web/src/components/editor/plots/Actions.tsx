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

import { useMemo } from 'react'
import { Extension } from '@codemirror/state'
import { markdownExtension } from '../extensions/markdown'
import { hideDelimiters } from '../extensions/hideDelimiters'
import { wikilinkExtension } from '../extensions/wikilink'
import { formattingKeymap } from '../extensions/formatting'

/**
 * Build href for a wikilink target.
 * Maps target to the correct URL path based on content type.
 */
function buildWikilinkHref(target: string): string {
  // Journal links: journals/YYYY-MM-DD -> /journal/YYYY-MM-DD
  if (target.startsWith('journals/')) {
    const date = target.slice('journals/'.length)
    return `/journal/${encodeURIComponent(date)}`
  }
  // Everything else (pages, custom content types) -> /page/path
  return `/page/${encodeURIComponent(target)}`
}

/**
 * Hook that returns CodeMirror extensions for formatting.
 * Called by Seed to get the extensions to load.
 */
export function useActions(): Extension[] {
  return useMemo(() => {
    return [
      markdownExtension(),
      hideDelimiters(),
      wikilinkExtension(buildWikilinkHref),
      formattingKeymap(),
    ]
  }, [])
}
