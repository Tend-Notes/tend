// SPDX-License-Identifier: MIT WITH Commons-Clause
// Block reference extension for CodeMirror
//
// Renders ((uuid)) block references as inline widgets showing the referenced
// block's content. When cursor is inside the syntax, shows raw ((uuid)) for editing.
// When cursor is outside, replaces with a styled widget that displays the block content.
//
// Features:
// - Fetches block content via API with in-memory caching
// - Chain link icon for navigation to source block
// - Children indicator bar if referenced block has children
// - Broken reference styling for missing blocks
// - 403 handling for encrypted gardens

import {
  EditorView,
  Decoration,
  DecorationSet,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { Extension, Range } from '@codemirror/state'
import * as api from '../../../lib/api'
import type { BlockRef } from '../../../types'

// Regex to find block references: ((uuid))
// UUID format: 8-4-4-4-12 hex characters
const BLOCK_REF_REGEX = /\(\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)\)/gi

interface BlockRefSpan {
  from: number
  to: number
  uuid: string
}

/**
 * Find all block references in the document
 */
function findBlockRefs(doc: string): BlockRefSpan[] {
  const results: BlockRefSpan[] = []
  let match
  BLOCK_REF_REGEX.lastIndex = 0

  while ((match = BLOCK_REF_REGEX.exec(doc)) !== null) {
    results.push({
      from: match.index,
      to: match.index + match[0].length,
      uuid: match[1],
    })
  }

  return results
}

// In-memory cache for block reference data
// Key: UUID, Value: BlockRef | null (null means not found/404)
type CacheEntry = {
  data: BlockRef | null
  error?: 'not_found' | 'encrypted' | 'error'
  timestamp: number
}

const blockRefCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 60 * 1000 // 1 minute cache TTL
const pendingFetches = new Map<string, Promise<CacheEntry>>()

/**
 * Get block reference data, using cache if available
 */
async function getBlockRef(uuid: string): Promise<CacheEntry> {
  // Check cache first
  const cached = blockRefCache.get(uuid)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached
  }

  // Check if there's already a pending fetch for this UUID
  const pending = pendingFetches.get(uuid)
  if (pending) {
    return pending
  }

  // Start a new fetch
  const fetchPromise = (async (): Promise<CacheEntry> => {
    try {
      const data = await api.blocks.lookup(uuid)
      const entry: CacheEntry = {
        data,
        error: data === null ? 'not_found' : undefined,
        timestamp: Date.now(),
      }
      blockRefCache.set(uuid, entry)
      return entry
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Unknown error'
      const isEncrypted = errorMsg.includes('403')
      const entry: CacheEntry = {
        data: null,
        error: isEncrypted ? 'encrypted' : 'error',
        timestamp: Date.now(),
      }
      blockRefCache.set(uuid, entry)
      return entry
    } finally {
      pendingFetches.delete(uuid)
    }
  })()

  pendingFetches.set(uuid, fetchPromise)
  return fetchPromise
}

/** Tag color values for rendering tags in block references */
interface TagColors {
  hue: number
  sat: number
  textL: number
  bgL: number
}

/**
 * Token types for parsed content
 */
type ContentToken =
  | { type: 'text'; content: string }
  | { type: 'bold'; content: string }
  | { type: 'italic'; content: string }
  | { type: 'bolditalic'; content: string }
  | { type: 'strikethrough'; content: string }
  | { type: 'highlight'; content: string }
  | { type: 'code'; content: string }
  | { type: 'tag'; name: string }
  | { type: 'wikilink'; target: string; display: string }
  | { type: 'url'; url: string }

/**
 * Parse block content into tokens for rendering
 * Handles markdown formatting, tags, wikilinks, and URLs
 */
function parseContent(content: string): ContentToken[] {
  const tokens: ContentToken[] = []
  let remaining = content

  // Combined regex for all patterns we want to match
  // Order matters: more specific patterns first
  const patterns = [
    // Bold italic (***text*** or ___text___)
    { regex: /(\*\*\*|___)(.+?)\1/, type: 'bolditalic' as const },
    // Bold (**text** or __text__)
    { regex: /(\*\*|__)(.+?)\1/, type: 'bold' as const },
    // Italic (*text* or _text_) - be careful not to match mid-word underscores
    { regex: /(?<![a-zA-Z0-9])([*_])(?![*_\s])(.+?)(?<![*_\s])\1(?![a-zA-Z0-9])/, type: 'italic' as const },
    // Strikethrough (~~text~~)
    { regex: /~~(.+?)~~/, type: 'strikethrough' as const },
    // Highlight (==text==)
    { regex: /==(.+?)==/, type: 'highlight' as const },
    // Inline code (`text`)
    { regex: /`([^`]+)`/, type: 'code' as const },
    // Wikilinks ([[target]] or [[target|display]])
    { regex: /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/, type: 'wikilink' as const },
    // Tags (#tag)
    { regex: /(?:^|\s)(#[a-zA-Z][a-zA-Z0-9_-]*)/, type: 'tag' as const },
    // URLs (http:// or https://)
    { regex: /(https?:\/\/[^\s<>[\]]+)/, type: 'url' as const },
  ]

  while (remaining.length > 0) {
    let earliestMatch: { index: number; match: RegExpExecArray; pattern: typeof patterns[0] } | null = null

    // Find the earliest matching pattern
    for (const pattern of patterns) {
      const match = pattern.regex.exec(remaining)
      if (match && (earliestMatch === null || match.index < earliestMatch.index)) {
        earliestMatch = { index: match.index, match, pattern }
      }
    }

    if (earliestMatch === null) {
      // No more matches - add remaining as text
      if (remaining.length > 0) {
        tokens.push({ type: 'text', content: remaining })
      }
      break
    }

    // Add text before the match
    if (earliestMatch.index > 0) {
      tokens.push({ type: 'text', content: remaining.slice(0, earliestMatch.index) })
    }

    // Add the matched token
    const { match, pattern } = earliestMatch
    switch (pattern.type) {
      case 'bolditalic':
        tokens.push({ type: 'bolditalic', content: match[2] })
        break
      case 'bold':
        tokens.push({ type: 'bold', content: match[2] })
        break
      case 'italic':
        tokens.push({ type: 'italic', content: match[2] })
        break
      case 'strikethrough':
        tokens.push({ type: 'strikethrough', content: match[1] })
        break
      case 'highlight':
        tokens.push({ type: 'highlight', content: match[1] })
        break
      case 'code':
        tokens.push({ type: 'code', content: match[1] })
        break
      case 'wikilink':
        tokens.push({
          type: 'wikilink',
          target: match[1],
          display: match[2] || match[1],
        })
        break
      case 'tag':
        // Tag regex captures leading whitespace - preserve it
        if (match[0].startsWith(' ') || match[0].startsWith('\t')) {
          tokens.push({ type: 'text', content: match[0][0] })
        }
        tokens.push({ type: 'tag', name: match[1].slice(1) }) // Remove #
        break
      case 'url':
        tokens.push({ type: 'url', url: match[1] })
        break
    }

    remaining = remaining.slice(earliestMatch.index + match[0].length)
  }

  return tokens
}

/**
 * Render parsed content tokens into DOM elements
 */
function renderContent(
  tokens: ContentToken[],
  onLinkNavigate?: (target: string) => void,
  getTagColors?: (name: string) => TagColors
): DocumentFragment {
  const fragment = document.createDocumentFragment()

  for (const token of tokens) {
    switch (token.type) {
      case 'text': {
        fragment.appendChild(document.createTextNode(token.content))
        break
      }
      case 'bold': {
        const span = document.createElement('strong')
        span.textContent = token.content
        fragment.appendChild(span)
        break
      }
      case 'italic': {
        const span = document.createElement('em')
        span.textContent = token.content
        fragment.appendChild(span)
        break
      }
      case 'bolditalic': {
        const strong = document.createElement('strong')
        const em = document.createElement('em')
        em.textContent = token.content
        strong.appendChild(em)
        fragment.appendChild(strong)
        break
      }
      case 'strikethrough': {
        const span = document.createElement('span')
        span.className = 'fmt-strikethrough'
        span.textContent = token.content
        fragment.appendChild(span)
        break
      }
      case 'highlight': {
        const span = document.createElement('span')
        span.className = 'fmt-highlight'
        span.textContent = token.content
        fragment.appendChild(span)
        break
      }
      case 'code': {
        const code = document.createElement('code')
        code.textContent = token.content
        fragment.appendChild(code)
        break
      }
      case 'wikilink': {
        const link = document.createElement('a')
        link.className = 'wiki-link'
        link.href = '#'
        // Display only the name after the last slash (for content type paths)
        const lastSlash = token.display.lastIndexOf('/')
        link.textContent = lastSlash >= 0 ? token.display.slice(lastSlash + 1) : token.display
        link.addEventListener('mousedown', (e) => {
          e.preventDefault()
          e.stopPropagation()
          if (e.button === 0) {
            onLinkNavigate?.(token.target)
          }
        })
        fragment.appendChild(link)
        break
      }
      case 'tag': {
        const span = document.createElement('span')
        span.className = 'tag-pill'
        span.textContent = `#${token.name}`
        span.style.cursor = 'pointer'
        // Apply tag colors if available
        if (getTagColors) {
          const colors = getTagColors(token.name)
          span.style.setProperty('--tag-hue', String(colors.hue))
          span.style.setProperty('--tag-sat', String(colors.sat))
          span.style.setProperty('--tag-textL', String(colors.textL))
          span.style.setProperty('--tag-bgL', String(colors.bgL))
        }
        span.addEventListener('mousedown', (e) => {
          e.preventDefault()
          e.stopPropagation()
          if (e.button === 0) {
            onLinkNavigate?.(`tags/${token.name}`)
          }
        })
        fragment.appendChild(span)
        break
      }
      case 'url': {
        const link = document.createElement('a')
        link.className = 'external-link'
        link.href = token.url
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        link.textContent = token.url
        // External links open in new tab, no need for navigation callback
        link.addEventListener('mousedown', (e) => {
          e.stopPropagation()
          // Let default behavior handle the navigation
        })
        fragment.appendChild(link)
        break
      }
    }
  }

  return fragment
}

/**
 * Chain link SVG icon for navigation
 */
function createChainIcon(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.classList.add('block-reference-chain')

  // Chain link path (two interlocking links)
  const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path1.setAttribute('d', 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71')
  svg.appendChild(path1)

  const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path2.setAttribute('d', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71')
  svg.appendChild(path2)

  return svg
}

/**
 * Widget that renders a block reference
 */
class BlockReferenceWidget extends WidgetType {
  constructor(
    readonly uuid: string,
    readonly onNavigate?: (pageName: string, blockUuid: string) => void,
    readonly onLinkNavigate?: (target: string) => void,
    readonly getTagColors?: (name: string) => TagColors
  ) {
    super()
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('span')
    container.className = 'block-reference block-reference-loading'
    container.setAttribute('data-uuid', this.uuid)

    // Start loading
    this.loadContent(container, view)

    return container
  }

  private async loadContent(container: HTMLElement, view: EditorView): Promise<void> {
    const entry = await getBlockRef(this.uuid)

    // Debug logging for block reference loading
    console.debug('[BlockRef]', this.uuid, 'entry:', {
      hasData: entry.data !== null,
      error: entry.error,
      content: entry.data?.content?.slice(0, 50),
    })

    // Widget might have been destroyed while loading
    if (!container.isConnected) return

    container.classList.remove('block-reference-loading')
    container.innerHTML = ''

    if (entry.error === 'encrypted') {
      container.className = 'block-reference block-reference-disabled'
      container.textContent = 'Block references unavailable'
      return
    }

    if (entry.error === 'not_found' || entry.data === null) {
      console.debug('[BlockRef]', this.uuid, 'showing missing - data:', entry.data, 'error:', entry.error)
      container.className = 'block-reference block-reference-missing'
      container.textContent = 'reference missing'
      return
    }

    if (entry.error === 'error') {
      container.className = 'block-reference block-reference-error'
      container.textContent = 'failed to load'
      return
    }

    // Successfully loaded - render like a normal block with chain icon replacing bullet
    container.className = 'block-reference'

    // Main row: chain icon (in bullet position) + content
    const mainRow = document.createElement('span')
    mainRow.className = 'block-reference-row'

    // Chain link icon (replaces bullet - same position as bullet would be)
    const chainIcon = createChainIcon()
    chainIcon.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.button === 0 && entry.data) {
        this.onNavigate?.(entry.data.pageName, this.uuid)
      }
    })
    mainRow.appendChild(chainIcon)

    // Content with parsed markdown, clickable links, and styled tags
    const contentSpan = document.createElement('span')
    contentSpan.className = 'block-reference-content'
    if (entry.data.content) {
      const tokens = parseContent(entry.data.content)
      const renderedContent = renderContent(tokens, this.onLinkNavigate, this.getTagColors)
      contentSpan.appendChild(renderedContent)
    } else {
      contentSpan.textContent = '(empty)'
    }
    mainRow.appendChild(contentSpan)

    container.appendChild(mainRow)

    // Children indicator (if block has children) - shown below the main row
    if (entry.data.hasChildren) {
      const childrenBar = document.createElement('div')
      childrenBar.className = 'block-reference-children'

      // Chevron icon
      const chevron = document.createElement('span')
      chevron.className = 'block-reference-children-chevron'
      chevron.textContent = '\u203a' // single right-pointing angle quotation mark
      childrenBar.appendChild(chevron)

      // Text
      const text = document.createElement('span')
      text.className = 'block-reference-children-text'
      text.textContent = 'View sub-bullets'
      childrenBar.appendChild(text)

      // Click handler for children bar
      childrenBar.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (e.button === 0 && entry.data) {
          this.onNavigate?.(entry.data.pageName, this.uuid)
        }
      })

      container.appendChild(childrenBar)
    }

    // Trigger a redraw to ensure decorations are positioned correctly
    view.requestMeasure()
  }

  eq(other: BlockReferenceWidget): boolean {
    return other.uuid === this.uuid
  }

  updateDOM(): boolean {
    // Returning false forces recreation when content changes
    return false
  }

  ignoreEvent(): boolean {
    return false
  }

}

// Decoration for block reference when cursor is inside (editable)
const blockRefEditableMark = Decoration.mark({ class: 'block-reference-editable' })

interface BlockReferenceOptions {
  /** Navigation callback when chain icon or children bar is clicked */
  onNavigate?: (pageName: string, blockUuid: string) => void
  /** Navigation callback for wikilinks and tags within the content */
  onLinkNavigate?: (target: string) => void
  /** Get tag colors for rendering tags */
  getTagColors?: (name: string) => TagColors
}

/**
 * Build decorations for block references
 */
function buildDecorations(
  view: EditorView,
  options: BlockReferenceOptions
): DecorationSet {
  const decorations: Range<Decoration>[] = []
  const doc = view.state.doc.toString()
  const cursorPos = view.state.selection.main.head
  const hasFocus = view.hasFocus

  const refs = findBlockRefs(doc)

  for (const ref of refs) {
    // Check if cursor is inside this block reference
    const cursorInside = hasFocus && cursorPos >= ref.from && cursorPos <= ref.to

    if (cursorInside) {
      // Show raw syntax when cursor is inside
      decorations.push(blockRefEditableMark.range(ref.from, ref.to))
    } else {
      // Replace with widget when cursor is outside
      decorations.push(
        Decoration.replace({
          widget: new BlockReferenceWidget(
            ref.uuid,
            options.onNavigate,
            options.onLinkNavigate,
            options.getTagColors
          ),
        }).range(ref.from, ref.to)
      )
    }
  }

  // Sort by position
  decorations.sort((a, b) => a.from - b.from)

  return Decoration.set(decorations)
}

/**
 * ViewPlugin that manages block reference decorations
 */
function createBlockReferencePlugin(options: BlockReferenceOptions) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, options)
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.focusChanged) {
          this.decorations = buildDecorations(update.view, options)
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  )
}

/**
 * Theme for block reference styling
 *
 * Design: Chain link icon replaces bullet, content has subtle background.
 * Renders like a normal block but with visual distinction.
 */
const blockReferenceTheme = EditorView.baseTheme({
  // Container - inline-flex column to stack main row and children indicator
  '.block-reference': {
    display: 'inline-flex',
    flexDirection: 'column',
    verticalAlign: 'baseline',
    maxWidth: '100%',
  },
  // Main row - flex row with chain icon and content (like a block with bullet)
  '.block-reference-row': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
  },
  '.block-reference-loading': {
    color: 'var(--color-text-muted, #545862)',
    fontStyle: 'italic',
  },
  '.block-reference-loading::before': {
    content: '"loading..."',
  },
  '.block-reference-missing': {
    color: 'var(--color-link-missing, #e06c75)',
    fontStyle: 'italic',
    textDecoration: 'line-through',
  },
  '.block-reference-disabled': {
    color: 'var(--color-text-muted, #545862)',
    fontStyle: 'italic',
  },
  '.block-reference-error': {
    color: 'var(--color-link-missing, #e06c75)',
    fontStyle: 'italic',
  },
  // Chain icon - in bullet position, clickable
  '.block-reference-chain': {
    display: 'inline-block',
    width: '14px',
    height: '14px',
    flexShrink: '0',
    color: 'var(--color-link, #61afef)',
    cursor: 'pointer',
  },
  '.block-reference-chain:hover': {
    color: 'var(--base0D, #61afef)',
    transform: 'scale(1.1)',
  },
  // Content - subtle background like code blocks
  '.block-reference-content': {
    display: 'inline',
    color: 'var(--color-text, #abb2bf)',
    backgroundColor: 'var(--color-bg-secondary, #353b45)',
    borderRadius: '3px',
    padding: '1px 6px',
  },
  // Children indicator bar
  '.block-reference-children': {
    display: 'flex',
    alignItems: 'center',
    marginTop: '2px',
    marginLeft: '22px', // Align with content (icon width + gap)
    paddingTop: '2px',
    borderTop: '1px solid var(--base02, #3e4451)',
    cursor: 'pointer',
    color: 'var(--color-text-muted, #545862)',
    fontSize: '0.85em',
  },
  '.block-reference-children:hover': {
    color: 'var(--color-link, #61afef)',
  },
  '.block-reference-children-chevron': {
    marginRight: '4px',
    fontWeight: 'bold',
  },
  '.block-reference-children-text': {
    fontStyle: 'italic',
  },
  // When editing (cursor inside) - muted appearance
  '.block-reference-editable': {
    backgroundColor: 'var(--color-bg-secondary, #353b45)',
    borderRadius: '2px',
    padding: '0 2px',
    color: 'var(--color-text-muted, #545862)',
  },
})

/**
 * Extension that renders ((uuid)) block references.
 *
 * When cursor is outside the syntax, replaces with a widget showing:
 * - Chain link icon (click to navigate to source)
 * - Block content text
 * - Children indicator bar (if block has sub-bullets)
 *
 * When cursor is inside, shows raw syntax for editing.
 */
export function blockReferenceExtension(options?: BlockReferenceOptions): Extension {
  return [
    createBlockReferencePlugin(options || {}),
    blockReferenceTheme,
  ]
}

/**
 * Invalidate the cache for a specific UUID.
 * Call this when a block is edited to ensure fresh content on next load.
 */
export function invalidateBlockRefCache(uuid: string): void {
  blockRefCache.delete(uuid)
}

/**
 * Clear the entire block reference cache.
 * Call this when switching gardens or on significant data changes.
 */
export function clearBlockRefCache(): void {
  blockRefCache.clear()
}
