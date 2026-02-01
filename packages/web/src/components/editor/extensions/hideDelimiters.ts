// SPDX-License-Identifier: MIT WITH Commons-Clause
// Delimiter hiding extension for BlockEditor
//
// Hides markdown delimiters (**, *, ~~, ==, `) when cursor is outside
// the formatted span. Shows them (dimmed) when cursor is inside.
//
// This creates a clean editing experience where formatting is visible
// but delimiters don't clutter the view until you need to edit them.

import {
  EditorView,
  Decoration,
  DecorationSet,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view'
import { EditorState, Range, Extension } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'

// Formatting node types from lezer-markdown that contain delimiters
const FORMAT_TYPES = new Set([
  'Emphasis',        // *text* or _text_
  'StrongEmphasis',  // **text** or __text__
  'InlineCode',      // `code`
  'Strikethrough',   // ~~text~~
  'Highlight',       // ==text== (custom)
])

// Decoration for hidden delimiters (visually collapsed)
const hiddenDelimiter = Decoration.mark({ class: 'cm-hidden-delimiter' })

// Decoration for visible delimiters (shown dimmed when cursor inside)
const visibleDelimiter = Decoration.mark({ class: 'cm-visible-delimiter' })

interface FormatSpan {
  from: number
  to: number
}

/**
 * Find all formatting spans that contain the given position.
 * Returns multiple spans for nested formatting (e.g., ***bold+italic***).
 */
function findContainingFormats(state: EditorState, pos: number): FormatSpan[] {
  const tree = syntaxTree(state)
  const results: FormatSpan[] = []

  tree.iterate({
    from: 0,
    to: state.doc.length,
    enter: (node) => {
      if (FORMAT_TYPES.has(node.name)) {
        if (pos >= node.from && pos <= node.to) {
          results.push({ from: node.from, to: node.to })
        }
      }
    },
  })

  return results
}

/**
 * Check if a node is a delimiter mark that should be hidden.
 * Excludes CodeMark inside FencedCode blocks (we only hide inline code delimiters).
 */
function isHideableDelimiter(name: string, parentName: string | undefined): boolean {
  // CodeMark inside FencedCode should NOT be hidden (those are the ``` fence lines)
  // Only hide CodeMark when it's part of InlineCode
  if (name === 'CodeMark') {
    return parentName === 'InlineCode'
  }

  return (
    name === 'EmphasisMark' ||
    name === 'StrikethroughMark' ||
    name === 'HighlightMark'
  )
}

/**
 * Build decorations for the document, hiding delimiters outside cursor range.
 */
function buildDecorations(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = []
  const state = view.state
  const cursorPos = state.selection.main.head
  const hasFocus = view.hasFocus

  // Find all format spans containing the cursor (handles nested formatting)
  // Only relevant if editor has focus; when unfocused, all delimiters are hidden
  const cursorFormats = hasFocus ? findContainingFormats(state, cursorPos) : []

  const tree = syntaxTree(state)

  // Iterate through all delimiter marks
  // Track the parent node to distinguish inline code from fenced code
  let parentStack: string[] = []

  tree.iterate({
    from: 0,
    to: state.doc.length,
    enter: (node) => {
      parentStack.push(node.name)

      // Get the immediate parent (second to last in stack)
      const parentName = parentStack.length >= 2 ? parentStack[parentStack.length - 2] : undefined

      if (isHideableDelimiter(node.name, parentName)) {
        // Check if this delimiter is inside any of the cursor's format spans
        const isInCursorSpan = cursorFormats.some(
          (format) => node.from >= format.from && node.to <= format.to
        )

        if (isInCursorSpan) {
          // Cursor is in this format span - show delimiter dimmed
          decorations.push(visibleDelimiter.range(node.from, node.to))
        } else {
          // Cursor is outside - hide delimiter
          decorations.push(hiddenDelimiter.range(node.from, node.to))
        }
      }
    },
    leave: () => {
      parentStack.pop()
    },
  })

  // Sort by position (required for DecorationSet)
  decorations.sort((a, b) => a.from - b.from)

  return Decoration.set(decorations)
}

/**
 * ViewPlugin that manages delimiter visibility based on cursor position.
 */
const hideDelimitersPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: ViewUpdate) {
      // Rebuild decorations when document, selection, or focus changes
      if (update.docChanged || update.selectionSet || update.focusChanged) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
)

/**
 * CSS theme for hidden/visible delimiters.
 */
const hideDelimitersTheme = EditorView.baseTheme({
  '.cm-hidden-delimiter': {
    fontSize: '0',
    letterSpacing: '0',
    color: 'transparent',
    lineHeight: '0',
  },
  '.cm-visible-delimiter': {
    color: 'var(--base04, #666)',
    opacity: '0.6',
  },
})

/**
 * Extension that hides markdown delimiters when cursor is outside.
 */
export function hideDelimiters(): Extension {
  return [hideDelimitersPlugin, hideDelimitersTheme]
}
