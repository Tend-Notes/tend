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
  WidgetType,
} from '@codemirror/view'
import { Range, Extension } from '@codemirror/state'
import { safeHref } from '../../../lib/safeHref'

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

// Regex to find wikilinks: [[target]] or [[target|display alias]]
const WIKILINK_REGEX = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g

interface WikilinkSpan {
  from: number
  to: number
  // Navigation/link target (the part before any "|")
  target: string
  // Optional display alias (the part after "|"), shown instead of the target
  display?: string
}

/**
 * Find all complete wikilinks in the document
 */
function findWikilinks(doc: string): WikilinkSpan[] {
  const results: WikilinkSpan[] = []
  let match
  WIKILINK_REGEX.lastIndex = 0
  while ((match = WIKILINK_REGEX.exec(doc)) !== null) {
    results.push({
      from: match.index,
      to: match.index + match[0].length,
      target: match[1],
      display: match[2],
    })
  }
  return results
}

/**
 * Find partial wikilink at cursor position (for suggestions)
 */
function findPartialWikilink(doc: string, cursorPos: number): { from: number; to: number; query: string } | null {
  // Look backwards from cursor for [[
  const textBefore = doc.slice(0, cursorPos)
  const textAfter = doc.slice(cursorPos)

  // Find the last [[ that isn't closed
  let searchPos = textBefore.length
  while (searchPos > 0) {
    const openIdx = textBefore.lastIndexOf('[[', searchPos - 1)
    if (openIdx === -1) break

    // Check if this [[ is closed before cursor
    const textAfterOpen = textBefore.slice(openIdx)
    if (!textAfterOpen.includes(']]')) {
      // Found [[ without ]] before cursor
      // BUT: check if there's a ]] after cursor that would complete this wikilink
      // If so, cursor is inside a COMPLETE wikilink - don't trigger popup
      const closingIdx = textAfter.indexOf(']]')
      if (closingIdx !== -1) {
        // Check that there's no [[ between cursor and the ]]
        // If there is, the ]] belongs to a different wikilink
        const textToClosing = textAfter.slice(0, closingIdx)
        if (!textToClosing.includes('[[')) {
          // Cursor is inside a complete wikilink - don't trigger popup
          return null
        }
      }

      // Found unclosed [[
      const query = textBefore.slice(openIdx + 2)
      // Don't trigger if query contains newlines or ]
      if (query.includes('\n') || query.includes(']')) return null
      return {
        from: openIdx,
        to: cursorPos,
        query,
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
 * Widget that renders an actual <a> element for the wikilink
 */
class WikilinkWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly buildHref: (target: string) => string,
    readonly onNavigate?: (target: string) => void,
    readonly display?: string
  ) {
    super()
  }

  toDOM(): HTMLElement {
    const link = document.createElement('a')
    link.href = safeHref(this.buildHref(this.target))
    link.className = 'wiki-link'
    // Prefer an explicit alias ([[target|alias]]); otherwise show the name after
    // the last slash (for content-type paths like person/John Smith).
    if (this.display) {
      link.textContent = this.display
    } else {
      const lastSlash = this.target.lastIndexOf('/')
      link.textContent = lastSlash >= 0 ? this.target.slice(lastSlash + 1) : this.target
    }

    // Prevent CodeMirror from handling mousedown (which would move cursor)
    link.addEventListener('mousedown', (e) => {
      e.stopPropagation()
      // For regular left-click, navigate using callback (SPA navigation)
      if (e.button === 0 && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        if (this.onNavigate) {
          this.onNavigate(this.target)
        } else {
          // Fallback to full page navigation if no callback provided
          window.location.href = link.href
        }
      }
      // For ctrl/cmd+click or middle-click, let browser handle it (new tab)
    })

    return link
  }

  eq(other: WikilinkWidget): boolean {
    return other.target === this.target && other.display === this.display
  }
}

/**
 * Build decorations for wikilinks
 */
function buildDecorations(
  view: EditorView,
  useWidgets: boolean,
  buildHref?: (target: string) => string,
  onNavigate?: (target: string) => void
): DecorationSet {
  const decorations: Range<Decoration>[] = []
  const doc = view.state.doc.toString()
  const cursorPos = view.state.selection.main.head
  const hasFocus = view.hasFocus

  const wikilinks = findWikilinks(doc)

  for (const wl of wikilinks) {
    // Check if cursor is inside this wikilink
    const cursorInside = hasFocus && cursorPos >= wl.from && cursorPos <= wl.to

    if (cursorInside) {
      // Cursor inside - show delimiters dimmed, content as text
      decorations.push(visibleDelimiter.range(wl.from, wl.from + 2))
      decorations.push(wikilinkContent.range(wl.from + 2, wl.to - 2))
      decorations.push(visibleDelimiter.range(wl.to - 2, wl.to))
    } else if (useWidgets && buildHref) {
      // Cursor outside - replace entire wikilink with widget (actual <a> tag)
      decorations.push(
        Decoration.replace({
          widget: new WikilinkWidget(wl.target, buildHref, onNavigate, wl.display),
        }).range(wl.from, wl.to)
      )
    } else {
      // Fallback: hide delimiters, style content
      decorations.push(hiddenDelimiter.range(wl.from, wl.from + 2))
      decorations.push(wikilinkContent.range(wl.from + 2, wl.to - 2))
      decorations.push(hiddenDelimiter.range(wl.to - 2, wl.to))
    }
  }

  // Sort by position
  decorations.sort((a, b) => a.from - b.from)

  return Decoration.set(decorations)
}

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
 * Complete a wikilink - replaces the partial with full syntax
 */
export function completeWikilink(view: EditorView, state: WikilinkState, target: string): void {
  const replacement = `[[${target}]]`
  view.dispatch({
    changes: { from: state.from, to: state.to, insert: replacement },
    selection: { anchor: state.from + replacement.length },
  })
}

/**
 * Create the wikilink decorations plugin
 */
function createWikilinkPlugin(
  buildHref?: (target: string) => string,
  onNavigate?: (target: string) => void
) {
  const useWidgets = !!buildHref

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, useWidgets, buildHref, onNavigate)
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.focusChanged) {
          this.decorations = buildDecorations(update.view, useWidgets, buildHref, onNavigate)
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  )
}

/**
 * Create an update listener that reports wikilink state changes for the popup
 */
export function wikilinkStateListener(
  onChange: (state: WikilinkState | null) => void
): Extension {
  let lastQuery: string | null = null

  return EditorView.updateListener.of((update) => {
    if (!update.view.hasFocus) {
      if (lastQuery !== null) {
        lastQuery = null
        onChange(null)
      }
      return
    }

    const doc = update.state.doc.toString()
    const cursorPos = update.state.selection.main.head
    const partial = findPartialWikilink(doc, cursorPos)

    if (partial) {
      // Only update if query changed (avoid unnecessary re-renders)
      if (partial.query !== lastQuery) {
        lastQuery = partial.query
        const coords = update.view.coordsAtPos(partial.from)
        if (coords) {
          onChange({
            from: partial.from,
            to: partial.to,
            query: partial.query,
            coords: { top: coords.bottom + 4, left: coords.left },
          })
        }
      }
    } else if (lastQuery !== null) {
      lastQuery = null
      onChange(null)
    }
  })
}

/**
 * Build href for a wikilink target
 * Encodes each path segment separately to preserve directory structure
 *
 * URL structure:
 * - Journals: /journal/YYYY-MM-DD
 * - Pages: /page/name
 * - Custom content types: /content-type-dir/name (e.g., /person/John%20Smith)
 */
function defaultBuildHref(target: string): string {
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
 * Options for wikilink extension
 */
export interface WikilinkOptions {
  /** Build the href for a wikilink target (for the <a> element) */
  buildHref?: (target: string) => string
  /** Navigation callback for SPA navigation (prevents full page reload) */
  onNavigate?: (target: string) => void
}

/**
 * Main extension factory
 */
export function wikilinkExtension(options?: WikilinkOptions): Extension {
  const buildHref = options?.buildHref ?? defaultBuildHref
  const onNavigate = options?.onNavigate
  return [
    createWikilinkPlugin(buildHref, onNavigate),
    wikilinkTheme,
  ]
}
