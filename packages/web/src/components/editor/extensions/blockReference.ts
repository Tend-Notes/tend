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
import { parseContent, renderContent, type TagColors } from '../contentRenderer'

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
