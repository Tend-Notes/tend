// SPDX-License-Identifier: MIT WITH Commons-Clause
// Wiki-link extension for CodeMirror
//
// Provides:
// - Syntax highlighting for [[wiki-links]]
// - Detection of in-progress wikilink typing (for suggestions popup)
// - Click handling for navigation
// - Proper delimiter hiding integration

import {
  EditorView,
  Decoration,
  DecorationSet,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view'
import { Range, Extension, StateField, StateEffect } from '@codemirror/state'

// State effect to signal wikilink state changes
export const setWikilinkState = StateEffect.define<WikilinkState | null>()

// Current wikilink being typed (for suggestions popup)
export interface WikilinkState {
  // Position of the opening [[
  from: number
  // Current cursor position (end of typed content)
  to: number
  // The query text (content after [[)
  query: string
  // Screen coordinates for popup positioning
  coords: { top: number; left: number }
}

// State field to track active wikilink input
export const wikilinkStateField = StateField.define<WikilinkState | null>({
  create: () => null,
  update: (value, tr) => {
    for (const effect of tr.effects) {
      if (effect.is(setWikilinkState)) {
        return effect.value
      }
    }
    return value
  },
})

// Regex to find wikilinks: [[content]]
const WIKILINK_REGEX = /\[\[([^\]]+)\]\]/g

interface WikilinkSpan {
  from: number
  to: number
  target: string
  isPartial: boolean
}

/**
 * Find all wikilinks in the document
 */
function findWikilinks(doc: string): WikilinkSpan[] {
  const results: WikilinkSpan[] = []

  // Find complete wikilinks
  let match
  WIKILINK_REGEX.lastIndex = 0
  while ((match = WIKILINK_REGEX.exec(doc)) !== null) {
    results.push({
      from: match.index,
      to: match.index + match[0].length,
      target: match[1],
      isPartial: false,
    })
  }

  return results
}

/**
 * Find partial wikilink at cursor position (for suggestions)
 */
function findPartialWikilink(doc: string, cursorPos: number): WikilinkSpan | null {
  // Look backwards from cursor for [[
  const textBefore = doc.slice(0, cursorPos)

  // Find the last [[ that isn't closed
  let searchPos = textBefore.length
  while (searchPos > 0) {
    const openIdx = textBefore.lastIndexOf('[[', searchPos - 1)
    if (openIdx === -1) break

    // Check if this [[ is closed before cursor
    const textAfterOpen = textBefore.slice(openIdx)
    if (!textAfterOpen.includes(']]')) {
      // Found unclosed [[
      const query = textBefore.slice(openIdx + 2)
      // Don't trigger if query contains newlines
      if (query.includes('\n')) return null
      return {
        from: openIdx,
        to: cursorPos,
        target: query,
        isPartial: true,
      }
    }
    searchPos = openIdx
  }

  return null
}

// Decoration for wikilink delimiters (hidden when cursor outside)
const hiddenDelimiter = Decoration.mark({ class: 'cm-wikilink-delimiter cm-hidden-delimiter' })
const visibleDelimiter = Decoration.mark({ class: 'cm-wikilink-delimiter cm-visible-delimiter' })

// Decoration for wikilink content
const wikilinkContent = Decoration.mark({ class: 'cm-wikilink-content wiki-link' })

/**
 * Build decorations for wikilinks
 */
function buildDecorations(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = []
  const doc = view.state.doc.toString()
  const cursorPos = view.state.selection.main.head

  const wikilinks = findWikilinks(doc)

  for (const wl of wikilinks) {
    // Check if cursor is inside this wikilink
    const cursorInside = cursorPos >= wl.from && cursorPos <= wl.to
    const delimDeco = cursorInside ? visibleDelimiter : hiddenDelimiter

    // Opening [[ (2 chars)
    decorations.push(delimDeco.range(wl.from, wl.from + 2))

    // Content
    decorations.push(wikilinkContent.range(wl.from + 2, wl.to - 2))

    // Closing ]] (2 chars)
    decorations.push(delimDeco.range(wl.to - 2, wl.to))
  }

  // Sort by position
  decorations.sort((a, b) => a.from - b.from)

  return Decoration.set(decorations)
}

/**
 * ViewPlugin for wikilink decorations and state tracking
 */
const wikilinkPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet) {
        this.decorations = buildDecorations(update.view)

        // Check for partial wikilink at cursor
        const doc = update.state.doc.toString()
        const cursorPos = update.state.selection.main.head
        const partial = findPartialWikilink(doc, cursorPos)

        if (partial) {
          // Get screen coordinates for popup
          const coords = update.view.coordsAtPos(partial.from)
          if (coords) {
            update.view.dispatch({
              effects: setWikilinkState.of({
                from: partial.from,
                to: partial.to,
                query: partial.target,
                coords: { top: coords.bottom + 4, left: coords.left },
              }),
            })
          }
        } else {
          // Clear wikilink state if no partial
          const currentState = update.state.field(wikilinkStateField)
          if (currentState) {
            update.view.dispatch({
              effects: setWikilinkState.of(null),
            })
          }
        }
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
)

/**
 * Theme for wikilink styling
 */
const wikilinkTheme = EditorView.baseTheme({
  '.cm-wikilink-content': {
    color: 'var(--color-link, #61afef)',
    cursor: 'pointer',
    borderRadius: '2px',
    padding: '0 2px',
  },
  '.cm-wikilink-content:hover': {
    backgroundColor: 'var(--color-bg-selection, #3e4451)',
  },
  '.cm-wikilink-delimiter': {
    color: 'var(--base04, #565c64)',
  },
})

/**
 * Click handler for wikilinks
 */
function wikilinkClickHandler(onNavigate: (target: string) => void): Extension {
  return EditorView.domEventHandlers({
    click: (event, view) => {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (pos === null) return false

      const doc = view.state.doc.toString()
      const wikilinks = findWikilinks(doc)

      for (const wl of wikilinks) {
        // Check if click is on the content (not delimiters)
        if (pos >= wl.from + 2 && pos <= wl.to - 2) {
          event.preventDefault()
          event.stopPropagation()
          onNavigate(wl.target)
          return true
        }
      }

      return false
    },
  })
}

/**
 * Complete a wikilink - replaces the partial with full syntax
 */
export function completeWikilink(view: EditorView, state: WikilinkState, target: string): void {
  const replacement = `[[${target}]]`
  view.dispatch({
    changes: { from: state.from, to: state.to, insert: replacement },
    selection: { anchor: state.from + replacement.length },
    effects: setWikilinkState.of(null),
  })
}

/**
 * Cancel wikilink completion (close popup without completing)
 */
export function cancelWikilink(view: EditorView): void {
  view.dispatch({
    effects: setWikilinkState.of(null),
  })
}

/**
 * Create an update listener that reports wikilink state changes
 */
export function wikilinkStateListener(
  onChange: (state: WikilinkState | null) => void
): Extension {
  let lastState: WikilinkState | null = null

  return EditorView.updateListener.of((update) => {
    try {
      const state = update.state.field(wikilinkStateField)
      // Only call onChange if state actually changed
      if (state !== lastState) {
        lastState = state
        onChange(state)
      }
    } catch {
      // Field not available
      if (lastState !== null) {
        lastState = null
        onChange(null)
      }
    }
  })
}

/**
 * Main extension factory
 */
export function wikilinkExtension(onNavigate: (target: string) => void): Extension {
  return [
    wikilinkStateField,
    wikilinkPlugin,
    wikilinkTheme,
    wikilinkClickHandler(onNavigate),
  ]
}
