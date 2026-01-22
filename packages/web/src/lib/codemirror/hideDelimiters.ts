// SPDX-License-Identifier: MIT WITH Commons-Clause
// CodeMirror extension to hide markdown delimiters when cursor is outside

import {
  EditorView,
  Decoration,
  DecorationSet,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view'
import { EditorState, Range } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'

// Formatting node types that contain delimiters
const FORMAT_TYPES = new Set([
  'Emphasis',        // *text* or _text_
  'StrongEmphasis',  // **text** or __text__
  'InlineCode',      // `code`
  'Strikethrough',   // ~~text~~
  'Highlight',       // ==text==
])

// Wikilink pattern: [[page name]]
const WIKILINK_REGEX = /\[\[([^\]]+)\]\]/g

// Tag pattern: #tagname (must start with letter, can have hyphens/underscores)
// Requires whitespace or start of string before the #
const TAG_REGEX = /(?:^|(?<=\s))#([a-zA-Z][a-zA-Z0-9_-]*)/g

// Decoration to hide delimiter text
const hiddenDelimiter = Decoration.mark({ class: 'cm-hidden-delimiter' })

// Decoration for revealed delimiter (cursor inside)
const visibleDelimiter = Decoration.mark({ class: 'cm-visible-delimiter' })

// Decoration for wikilink content (the page name)
const wikiLinkContent = Decoration.mark({ class: 'cm-wikilink' })

// Create tag decoration with the tag name as a data attribute
function tagDecoration(tagName: string) {
  return Decoration.mark({
    class: 'cm-tag',
    attributes: { 'data-tag': tagName },
  })
}

/**
 * A span representing either a syntax node, tag, or fenced code block.
 */
interface FormatSpan {
  from: number
  to: number
  type: 'syntax' | 'tag' | 'fencedCode'
}

/**
 * Find the formatting span that contains the given position.
 */
function findContainingFormat(state: EditorState, pos: number): FormatSpan | null {
  const tree = syntaxTree(state)
  let result: FormatSpan | null = null

  // Check syntax tree nodes
  tree.iterate({
    from: 0,
    to: state.doc.length,
    enter: (node) => {
      if (FORMAT_TYPES.has(node.name)) {
        if (pos >= node.from && pos <= node.to) {
          result = { from: node.from, to: node.to, type: 'syntax' }
        }
      }
      // Check for fenced code blocks
      if (node.name === 'FencedCode') {
        if (pos >= node.from && pos <= node.to) {
          result = { from: node.from, to: node.to, type: 'fencedCode' }
        }
      }
    },
  })

  // Check tags
  const text = state.doc.toString()
  let match
  TAG_REGEX.lastIndex = 0
  while ((match = TAG_REGEX.exec(text)) !== null) {
    // match[0] is the full match including #, match.index is where # starts
    const hashPos = text.lastIndexOf('#', match.index + match[0].length)
    const from = hashPos
    const to = hashPos + 1 + match[1].length  // # + tagName
    if (pos >= from && pos <= to) {
      result = { from, to, type: 'tag' }
    }
  }

  return result
}

/**
 * Check if a node is a delimiter mark.
 */
function isDelimiterNode(name: string): boolean {
  // lezer-markdown uses EmphasisMark for both * and **
  return name === 'EmphasisMark' || name === 'CodeMark' || name === 'StrikethroughMark' || name === 'HighlightMark'
}

/**
 * Build decorations for the document, hiding delimiters outside cursor range.
 */
function buildDecorations(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = []
  const state = view.state
  const cursorPos = state.selection.main.head

  // Find the format span containing the cursor (if any)
  const cursorFormat = findContainingFormat(state, cursorPos)

  const tree = syntaxTree(state)

  // Track fenced code blocks to handle their delimiters separately
  const fencedCodeBlocks: Array<{ from: number; to: number }> = []

  // First pass: collect fenced code blocks
  tree.iterate({
    from: 0,
    to: state.doc.length,
    enter: (node) => {
      if (node.name === 'FencedCode') {
        fencedCodeBlocks.push({ from: node.from, to: node.to })
      }
    },
  })

  // Check if a position is inside any fenced code block
  const isInFencedCode = (pos: number) =>
    fencedCodeBlocks.some(block => pos >= block.from && pos <= block.to)

  // Handle markdown delimiter nodes (inline formatting)
  tree.iterate({
    from: 0,
    to: state.doc.length,
    enter: (node) => {
      // Skip CodeMark nodes inside fenced code blocks (handled separately)
      if (node.name === 'CodeMark' && isInFencedCode(node.from)) {
        return
      }

      if (isDelimiterNode(node.name)) {
        // Check if this delimiter is inside the cursor's format span
        const isInCursorSpan = cursorFormat &&
          cursorFormat.type === 'syntax' &&
          node.from >= cursorFormat.from &&
          node.to <= cursorFormat.to

        if (isInCursorSpan) {
          // Cursor is in this format span - show delimiter dimmed
          decorations.push(visibleDelimiter.range(node.from, node.to))
        } else {
          // Cursor is outside - hide delimiter
          decorations.push(hiddenDelimiter.range(node.from, node.to))
        }
      }
    },
  })

  // Handle fenced code blocks: hide ``` and language info when cursor outside
  for (const block of fencedCodeBlocks) {
    const isInCursorSpan = cursorFormat &&
      cursorFormat.type === 'fencedCode' &&
      cursorFormat.from === block.from &&
      cursorFormat.to === block.to

    // Find the CodeMark and CodeInfo nodes within this block
    tree.iterate({
      from: block.from,
      to: block.to,
      enter: (node) => {
        if (node.name === 'CodeMark' || node.name === 'CodeInfo') {
          if (isInCursorSpan) {
            // Cursor inside - show delimiter dimmed
            decorations.push(visibleDelimiter.range(node.from, node.to))
          } else {
            // Cursor outside - hide delimiter
            decorations.push(hiddenDelimiter.range(node.from, node.to))
          }
        }
        // Style the code text
        if (node.name === 'CodeText') {
          decorations.push(Decoration.mark({ class: 'cm-fenced-code' }).range(node.from, node.to))
        }
      },
    })
  }

  // Handle wikilinks: style content as link, keep brackets visible
  const text = state.doc.toString()
  WIKILINK_REGEX.lastIndex = 0
  let match
  while ((match = WIKILINK_REGEX.exec(text)) !== null) {
    const from = match.index
    const to = match.index + match[0].length
    const openBracketEnd = from + 2  // [[
    const closeBracketStart = to - 2  // ]]

    // Style the content (page name) as a link - brackets stay visible
    decorations.push(wikiLinkContent.range(openBracketEnd, closeBracketStart))
  }

  // Handle tags: hide # when cursor outside, style as pill
  TAG_REGEX.lastIndex = 0
  while ((match = TAG_REGEX.exec(text)) !== null) {
    const tagName = match[1]
    // Find the actual # position (match might include leading whitespace due to lookbehind)
    const hashPos = text.lastIndexOf('#', match.index + match[0].length)
    const from = hashPos
    const to = hashPos + 1 + tagName.length  // # + tagName

    // Check if cursor is inside this tag
    const isInCursorSpan = cursorFormat &&
      cursorFormat.type === 'tag' &&
      cursorFormat.from === from &&
      cursorFormat.to === to

    if (isInCursorSpan) {
      // Cursor inside - show # dimmed
      decorations.push(visibleDelimiter.range(from, from + 1))
      // Style the tag name
      decorations.push(tagDecoration(tagName).range(from + 1, to))
    } else {
      // Cursor outside - hide #
      decorations.push(hiddenDelimiter.range(from, from + 1))
      // Style the tag name as pill
      decorations.push(tagDecoration(tagName).range(from + 1, to))
    }
  }

  // Sort by position (required for DecorationSet)
  decorations.sort((a, b) => a.from - b.from)

  return Decoration.set(decorations)
}

/**
 * ViewPlugin that manages delimiter visibility based on cursor position.
 */
export const hideDelimitersPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: ViewUpdate) {
      // Rebuild decorations when document or selection changes
      if (update.docChanged || update.selectionSet) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
)

/**
 * CSS theme for hidden/visible delimiters, wikilinks, and tags.
 */
export const hideDelimitersTheme = EditorView.baseTheme({
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
  '.cm-wikilink': {
    color: 'var(--base0D, #81a2be)',
    textDecoration: 'underline',
    cursor: 'pointer',
  },
  '.cm-tag': {
    display: 'inline-block',
    backgroundColor: 'color-mix(in srgb, var(--tag-color, var(--base0E)) 20%, transparent)',
    color: 'var(--tag-color, var(--base0E))',
    padding: '0 6px',
    borderRadius: '10px',
    fontSize: '0.9em',
    cursor: 'pointer',
  },
  '.cm-fenced-code': {
    fontFamily: 'var(--font-mono, monospace)',
    fontSize: '0.9em',
  },
})

/**
 * Extension that hides markdown delimiters when cursor is outside.
 */
export function hideDelimiters() {
  return [hideDelimitersPlugin, hideDelimitersTheme]
}
