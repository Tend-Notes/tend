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

/**
 * Hook that returns CodeMirror extensions for formatting.
 * Called by Seed to get the extensions to load.
 */
export function useActions(): Extension[] {
  return useMemo(() => {
    return [
      markdownExtension(),
      hideDelimiters(),
    ]
  }, [])
}
