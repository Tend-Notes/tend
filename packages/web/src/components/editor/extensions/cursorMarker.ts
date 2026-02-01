// SPDX-License-Identifier: MIT WITH Commons-Clause
// Cursor marker extension for CodeMirror
//
// Provides visual highlighting for {{cursor}} markers in template editing.
// When a template contains {{cursor}}, it indicates where the cursor
// should be placed when a new sheet is created from the template.

import {
  EditorView,
  Decoration,
  DecorationSet,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view'
import { Extension, Range } from '@codemirror/state'

// Regex to find cursor markers
const CURSOR_MARKER_REGEX = /\{\{cursor\}\}/g

// Decoration for the cursor marker - styled distinctively
const cursorMarkerDecoration = Decoration.mark({
  class: 'cm-cursor-marker',
  attributes: {
    title: 'Cursor will be placed here when creating a new sheet',
  },
})

/**
 * Find all cursor markers in the document
 */
function findCursorMarkers(doc: string): { from: number; to: number }[] {
  const results: { from: number; to: number }[] = []
  let match
  CURSOR_MARKER_REGEX.lastIndex = 0
  while ((match = CURSOR_MARKER_REGEX.exec(doc)) !== null) {
    results.push({
      from: match.index,
      to: match.index + match[0].length,
    })
  }
  return results
}

/**
 * Build decorations for cursor markers
 */
function buildDecorations(view: EditorView): DecorationSet {
  const doc = view.state.doc.toString()
  const markers = findCursorMarkers(doc)

  if (markers.length === 0) {
    return Decoration.none
  }

  const decorations: Range<Decoration>[] = []

  for (const marker of markers) {
    decorations.push(cursorMarkerDecoration.range(marker.from, marker.to))
  }

  return Decoration.set(decorations, true)
}

/**
 * ViewPlugin that manages cursor marker decorations
 */
const cursorMarkerPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
)

/**
 * Theme for cursor marker styling
 */
const cursorMarkerTheme = EditorView.baseTheme({
  '.cm-cursor-marker': {
    backgroundColor: 'var(--base0A, #f0c674)',
    color: 'var(--base00, #1d1f21)',
    borderRadius: '2px',
    padding: '0 2px',
    fontFamily: 'monospace',
    fontSize: '0.9em',
  },
})

/**
 * Extension that highlights {{cursor}} markers in templates
 */
export function cursorMarkerExtension(): Extension {
  return [cursorMarkerPlugin, cursorMarkerTheme]
}
