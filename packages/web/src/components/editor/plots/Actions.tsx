// SPDX-License-Identifier: MIT WITH Commons-Clause
// Actions: Formatting layer for Seeds
//
// Provides CodeMirror extensions for markdown formatting.
// Seeds contain Actions; Actions load extensions.
//
// Actions is responsible for:
// - Core markdown syntax highlighting
// - Delimiter hiding (showing/hiding ** ~~ == etc.)
// - Loading and combining extensions
//
// Specific features (wiki-links, block references, etc.) are
// implemented as extensions that plug into Actions.

import { useMemo } from 'react'
import { Extension } from '@codemirror/state'
import { markdownExtension } from '../extensions/markdown'
import { hideDelimiters } from '../extensions/hideDelimiters'

export interface UseActionsOptions {
  /** Additional extensions to load (wiki-links, block references, etc.) */
  extensions?: Extension[]
}

/**
 * Hook that returns CodeMirror extensions for formatting.
 * Called by Seed to get the extensions to load.
 */
export function useActions(options: UseActionsOptions = {}): Extension[] {
  const { extensions: additionalExtensions = [] } = options

  return useMemo(() => {
    return [
      markdownExtension(),
      hideDelimiters(),
      ...additionalExtensions,
    ]
  }, [additionalExtensions])
}
