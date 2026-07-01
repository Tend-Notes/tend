// SPDX-License-Identifier: MIT WITH Commons-Clause
// Shared content parsing and rendering utilities
//
// Provides tokenization of block content (markdown formatting, wikilinks, tags,
// URLs, task statuses, block references, header prefixes) and renderers for both
// CodeMirror DOM widgets and React components.

import React, { useState, useEffect, useCallback } from 'react'
import { blocks } from '../../lib/api'
import type { BlockRef } from '../../types'

/**
 * Tag color values for rendering tags
 */
export interface TagColors {
  hue: number
  sat: number
  textL: number
  bgL: number
}

/**
 * Token types for parsed content
 */
export type ContentTokenData =
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
  | { type: 'taskStatus'; keyword: string; color: string }
  | { type: 'blockReference'; uuid: string }
  | { type: 'headerPrefix'; level: number }

// Source span attached to every token at parse time, so caret offset mapping is
// a lookup instead of per-type arithmetic re-derived in three places (EF-08).
//   srcFrom..srcFrom+srcLen  is the token's full source range (delimiters incl.)
//   the rendered (visible) text is the source substring
//     [srcFrom+lead, srcFrom+lead+renderedLen)
// so a delimiter's width lives in `lead`/(srcLen-lead-renderedLen), never in the
// maps. Zero-width rendered tokens (header prefix) have renderedLen === 0.
export interface TokenSpan {
  srcFrom: number
  srcLen: number
  lead: number
  renderedLen: number
}

export type ContentToken = ContentTokenData & { span: TokenSpan }

// UUID regex pattern for block references
const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

// All task status keywords from both sets
const TASK_KEYWORDS = ['TODO', 'DOING', 'DONE', 'NOW', 'LATER', 'NEVER']

// Map keywords to their colors (matching settingsStore TASK_STATUS_SETS)
const TASK_KEYWORD_COLORS: Record<string, string> = {
  TODO: 'base-0A',
  DOING: 'base-0D',
  DONE: 'base-0B',
  NOW: 'base-08',
  LATER: 'base-0A',
  NEVER: 'base-03',
}

/**
 * Parse block content into tokens for rendering.
 * Handles markdown formatting, tags, wikilinks, URLs, task statuses,
 * block references, and header prefixes.
 */
export function parseContent(content: string): ContentToken[] {
  const tokens: ContentToken[] = []
  let remaining = content
  // Absolute number of `content` characters already consumed, so each token can
  // record its source span (EF-08).
  let base = 0

  const push = (
    token: ContentTokenData,
    srcFrom: number,
    srcLen: number,
    lead: number,
    renderedLen: number,
  ) => {
    tokens.push({ ...token, span: { srcFrom, srcLen, lead, renderedLen } })
  }

  // Check for header prefix at the very start
  const headerMatch = remaining.match(/^(#{1,6})\s/)
  if (headerMatch) {
    // The whole prefix (hashes + one space) is delimiter: lead === srcLen, no
    // rendered width.
    push({ type: 'headerPrefix', level: headerMatch[1].length }, base, headerMatch[0].length, headerMatch[0].length, 0)
    remaining = remaining.slice(headerMatch[0].length)
    base += headerMatch[0].length
  }

  // Check for task status keyword at the start (after any header prefix)
  const taskMatch = remaining.match(new RegExp(`^(${TASK_KEYWORDS.join('|')})\\s`))
  if (taskMatch) {
    const keyword = taskMatch[1]
    // Rendered as a badge of the keyword; the trailing space is delimiter.
    push(
      { type: 'taskStatus', keyword, color: TASK_KEYWORD_COLORS[keyword] || 'base-03' },
      base,
      taskMatch[0].length,
      0,
      keyword.length,
    )
    remaining = remaining.slice(taskMatch[0].length)
    base += taskMatch[0].length
  }

  // Combined regex for all patterns we want to match
  // Order matters: more specific patterns first
  const patterns = [
    // Block references ((uuid))
    { regex: new RegExp(`\\(\\((${UUID_PATTERN})\\)\\)`, 'i'), type: 'blockReference' as const },
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
    // URLs (http:// or https://). Stop at formatting delimiters (* and `) so a
    // URL doesn't swallow adjacent markup like **bold** or `code` (EF-18,
    // partial — escape handling / trailing-punctuation trimming are left for the
    // parser rewrite).
    { regex: /(https?:\/\/[^\s<>[\]*`]+)/, type: 'url' as const },
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
        push({ type: 'text', content: remaining }, base, remaining.length, 0, remaining.length)
      }
      break
    }

    // Add text before the match
    const { match, pattern, index } = earliestMatch
    if (index > 0) {
      push({ type: 'text', content: remaining.slice(0, index) }, base, index, 0, index)
    }

    // Add the matched token. srcLen is always match[0].length; `lead` is the
    // width of the leading delimiter, so the visible text is the source
    // substring [srcFrom+lead, srcFrom+lead+renderedLen).
    const tokFrom = base + index
    const srcLen = match[0].length
    switch (pattern.type) {
      case 'blockReference':
        push({ type: 'blockReference', uuid: match[1] }, tokFrom, srcLen, 0, match[1].length + 4)
        break
      case 'bolditalic':
        push({ type: 'bolditalic', content: match[2] }, tokFrom, srcLen, 3, match[2].length)
        break
      case 'bold':
        push({ type: 'bold', content: match[2] }, tokFrom, srcLen, 2, match[2].length)
        break
      case 'italic':
        push({ type: 'italic', content: match[2] }, tokFrom, srcLen, 1, match[2].length)
        break
      case 'strikethrough':
        push({ type: 'strikethrough', content: match[1] }, tokFrom, srcLen, 2, match[1].length)
        break
      case 'highlight':
        push({ type: 'highlight', content: match[1] }, tokFrom, srcLen, 2, match[1].length)
        break
      case 'code':
        push({ type: 'code', content: match[1] }, tokFrom, srcLen, 1, match[1].length)
        break
      case 'wikilink': {
        const target = match[1]
        const display = match[2] || match[1]
        // Displayed text is the part of `display` after its last slash.
        const lastSlash = display.lastIndexOf('/')
        const displayText = lastSlash >= 0 ? display.slice(lastSlash + 1) : display
        // Where the visible text begins within the source: past "[[", past
        // "target|" if aliased, then past everything up to the last slash.
        const displayStartInSrc = match[2] ? 2 + target.length + 1 : 2
        const lead = displayStartInSrc + (lastSlash >= 0 ? lastSlash + 1 : 0)
        push({ type: 'wikilink', target, display }, tokFrom, srcLen, lead, displayText.length)
        break
      }
      case 'tag': {
        // Tag regex captures leading whitespace - emit it as its own text token.
        const hasLeadingSpace = match[0].startsWith(' ') || match[0].startsWith('\t')
        let tagFrom = tokFrom
        if (hasLeadingSpace) {
          push({ type: 'text', content: match[0][0] }, tokFrom, 1, 0, 1)
          tagFrom = tokFrom + 1
        }
        const name = match[1].slice(1) // Remove #
        push({ type: 'tag', name }, tagFrom, name.length + 1, 0, name.length + 1)
        break
      }
      case 'url':
        push({ type: 'url', url: match[1] }, tokFrom, srcLen, 0, match[1].length)
        break
    }

    const consumed = index + match[0].length
    remaining = remaining.slice(consumed)
    base += consumed
  }

  return tokens
}

/**
 * Render parsed content tokens into DOM elements (for CodeMirror widgets)
 */
export function renderContent(
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
      case 'taskStatus': {
        // Convert 'base-0A' to 'base0A' for CSS variable
        const cssColor = token.color.replace('-', '')
        const span = document.createElement('span')
        span.className = 'task-status-badge'
        span.textContent = token.keyword
        span.style.cssText = `
          display: inline-block;
          padding: 1px 6px;
          margin-right: 6px;
          font-size: 0.75em;
          font-weight: 600;
          border-radius: 3px;
          background-color: var(--${cssColor}, #666);
          color: var(--base00, #fff);
          user-select: none;
        `
        fragment.appendChild(span)
        break
      }
      case 'blockReference': {
        const span = document.createElement('span')
        span.setAttribute('data-block-ref', token.uuid)
        span.textContent = `((${token.uuid}))`
        fragment.appendChild(span)
        break
      }
      case 'headerPrefix': {
        // Header prefix is hidden in display mode - skip rendering
        break
      }
    }
  }

  return fragment
}

// ============================================================================
// Block Reference Display (React component for dormant mode)
// ============================================================================

// Simple cache for block references (shared across all BlockReferenceDisplay instances)
const blockRefReactCache = new Map<string, { data: BlockRef | null; timestamp: number }>()
const BLOCK_REF_CACHE_TTL = 60000 // 1 minute

interface BlockReferenceDisplayProps {
  uuid: string
  onNavigate?: (target: string) => void
  onLinkNavigate?: (target: string) => void
  getTagColors?: (name: string) => TagColors
}

/**
 * React component that fetches and displays a block reference.
 * Used by DormantSeed to render block references without CodeMirror.
 */
function BlockReferenceDisplay({ uuid, onNavigate, onLinkNavigate, getTagColors }: BlockReferenceDisplayProps) {
  const [blockData, setBlockData] = useState<BlockRef | null | 'loading' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false

    // Check cache first
    const cached = blockRefReactCache.get(uuid)
    if (cached && Date.now() - cached.timestamp < BLOCK_REF_CACHE_TTL) {
      setBlockData(cached.data)
      return
    }

    // Fetch block data
    blocks.lookup(uuid).then((data) => {
      if (cancelled) return
      blockRefReactCache.set(uuid, { data, timestamp: Date.now() })
      setBlockData(data)
    }).catch(() => {
      if (cancelled) return
      setBlockData('error')
    })

    return () => { cancelled = true }
  }, [uuid])

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (blockData && blockData !== 'loading' && blockData !== 'error') {
      onNavigate?.(blockData.pageName)
    }
  }, [blockData, onNavigate])

  // Loading state
  if (blockData === 'loading') {
    return React.createElement(
      'span',
      { className: 'block-reference block-reference-loading', 'data-block-ref': uuid },
      '...'
    )
  }

  // Error state
  if (blockData === 'error') {
    return React.createElement(
      'span',
      { className: 'block-reference block-reference-error', 'data-block-ref': uuid },
      'failed to load'
    )
  }

  // Not found
  if (blockData === null) {
    return React.createElement(
      'span',
      { className: 'block-reference block-reference-missing', 'data-block-ref': uuid },
      'reference missing'
    )
  }

  // Parse and render the referenced content
  const contentTokens = parseContent(blockData.content)
  const renderedContent = renderContentReact(contentTokens, onLinkNavigate, getTagColors)

  // Render like the CodeMirror widget: chain icon + content in a row
  return React.createElement(
    'span',
    { className: 'block-reference', 'data-block-ref': uuid },
    // Row wrapper for icon + content (horizontal layout)
    React.createElement(
      'span',
      { className: 'block-reference-row' },
      // Chain link icon (clickable to navigate)
      React.createElement(
        'span',
        {
          className: 'block-reference-chain',
          onClick: handleClick,
          title: `Go to ${blockData.pageName}`,
        },
        React.createElement(
          'svg',
          {
            width: 14,
            height: 14,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          React.createElement('path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }),
          React.createElement('path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' })
        )
      ),
      // Content
      React.createElement(
        'span',
        { className: 'block-reference-content' },
        renderedContent
      )
    ),
    // Children indicator (if has children) - clicking navigates to the page
    blockData.hasChildren && React.createElement(
      'span',
      {
        className: 'block-reference-children',
        onClick: handleClick,
        title: `View children in ${blockData.pageName}`,
      },
      React.createElement('span', { className: 'block-reference-children-chevron' }, '›'),
      React.createElement('span', { className: 'block-reference-children-text' }, 'View sub-bullets')
    )
  )
}

/**
 * Render parsed content tokens as React elements.
 * Returns an array of React nodes suitable for use in JSX.
 */
export function renderContentReact(
  tokens: ContentToken[],
  onLinkNavigate?: (target: string) => void,
  getTagColors?: (name: string) => TagColors,
  onBlockRefNavigate?: (pageName: string) => void
): React.ReactNode[] {
  const nodes: React.ReactNode[] = []

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    const key = `token-${i}`

    switch (token.type) {
      case 'text': {
        nodes.push(token.content)
        break
      }
      case 'bold': {
        nodes.push(
          React.createElement('strong', { key, className: 'fmt-bold' }, token.content)
        )
        break
      }
      case 'italic': {
        nodes.push(
          React.createElement('em', { key, className: 'fmt-italic' }, token.content)
        )
        break
      }
      case 'bolditalic': {
        nodes.push(
          React.createElement(
            'strong',
            { key, className: 'fmt-bold' },
            React.createElement('em', { className: 'fmt-italic' }, token.content)
          )
        )
        break
      }
      case 'strikethrough': {
        nodes.push(
          React.createElement('del', { key, className: 'fmt-strikethrough' }, token.content)
        )
        break
      }
      case 'highlight': {
        nodes.push(
          React.createElement('mark', { key, className: 'fmt-highlight' }, token.content)
        )
        break
      }
      case 'code': {
        nodes.push(
          React.createElement('code', { key }, token.content)
        )
        break
      }
      case 'wikilink': {
        // Display only the name after the last slash (for content type paths)
        const lastSlash = token.display.lastIndexOf('/')
        const displayText = lastSlash >= 0 ? token.display.slice(lastSlash + 1) : token.display
        nodes.push(
          React.createElement(
            'a',
            {
              key,
              className: 'wiki-link',
              href: '#',
              onClick: (e: React.MouseEvent) => {
                e.preventDefault()
                e.stopPropagation()
                onLinkNavigate?.(token.target)
              },
            },
            displayText
          )
        )
        break
      }
      case 'tag': {
        const tagStyle: Record<string, string | number> = { cursor: 'pointer' }
        if (getTagColors) {
          const colors = getTagColors(token.name)
          tagStyle['--tag-hue'] = colors.hue
          tagStyle['--tag-sat'] = colors.sat
          tagStyle['--tag-textL'] = colors.textL
          tagStyle['--tag-bgL'] = colors.bgL
        }
        nodes.push(
          React.createElement(
            'span',
            {
              key,
              className: 'tag-pill',
              style: tagStyle as React.CSSProperties,
              onClick: (e: React.MouseEvent) => {
                e.preventDefault()
                e.stopPropagation()
                onLinkNavigate?.(`tags/${token.name}`)
              },
            },
            `#${token.name}`
          )
        )
        break
      }
      case 'url': {
        nodes.push(
          React.createElement(
            'a',
            {
              key,
              href: token.url,
              target: '_blank',
              rel: 'noopener noreferrer',
            },
            token.url
          )
        )
        break
      }
      case 'taskStatus': {
        // Convert 'base-0A' to 'base0A' for CSS variable
        const cssColor = token.color.replace('-', '')
        const badgeStyle: React.CSSProperties = {
          display: 'inline-block',
          padding: '1px 6px',
          marginRight: '6px',
          fontSize: '0.75em',
          fontWeight: 600,
          borderRadius: '3px',
          backgroundColor: `var(--${cssColor}, #666)`,
          color: 'var(--base00, #fff)',
          userSelect: 'none',
        }
        nodes.push(
          React.createElement(
            'span',
            { key, className: 'task-status-badge', style: badgeStyle },
            token.keyword
          )
        )
        break
      }
      case 'blockReference': {
        nodes.push(
          React.createElement(BlockReferenceDisplay, {
            key,
            uuid: token.uuid,
            onNavigate: onBlockRefNavigate,
            onLinkNavigate,
            getTagColors,
          })
        )
        break
      }
      case 'headerPrefix': {
        // Header prefix is hidden in display mode - skip rendering
        break
      }
    }
  }

  return nodes
}

/**
 * Map from rendered-text offset (what the user sees, no delimiters) to
 * source-markdown offset (including **, ~~, ==, `, [[]], etc.).
 *
 * Walks the token list, accumulating both rendered length and source length.
 * When the rendered offset falls within a token, linearly maps to the
 * corresponding source position.
 */
export function mapRenderedOffsetToSource(
  tokens: ContentToken[],
  renderedOffset: number
): number {
  let renderedPos = 0
  let lastSourceEnd = 0

  for (const token of tokens) {
    const { srcFrom, srcLen, lead, renderedLen } = token.span
    lastSourceEnd = srcFrom + srcLen

    if (renderedOffset <= renderedPos + renderedLen) {
      // A zero-width rendered token (e.g. the header prefix) occupies no visible
      // space, so let the offset fall through to the next token — that maps
      // rendered offset 0 onto the first real character, not before the hashes.
      if (renderedLen === 0) continue
      // The visible text is the source substring at [srcFrom+lead, ...], so the
      // caret maps straight in — no per-type delimiter arithmetic.
      return srcFrom + lead + (renderedOffset - renderedPos)
    }

    renderedPos += renderedLen
  }

  // Offset is past all tokens - return end of source
  return lastSourceEnd
}

/**
 * Map from source-markdown offset (including **, ~~, ==, `, [[]], etc.) to
 * rendered-text offset (what the user sees, no delimiters).
 *
 * Inverse of mapRenderedOffsetToSource. Walks the token list, accumulating
 * both source length and rendered length. When the source offset falls within
 * a token, maps to the corresponding rendered position.
 */
export function mapSourceOffsetToRendered(
  tokens: ContentToken[],
  sourceOffset: number
): number {
  let renderedPos = 0
  let lastRenderedEnd = 0

  for (const token of tokens) {
    const { srcFrom, srcLen, lead, renderedLen } = token.span
    lastRenderedEnd = renderedPos + renderedLen

    if (sourceOffset <= srcFrom + srcLen) {
      // Source before the leading delimiter clamps to the token's rendered
      // start; source past the visible text clamps to its rendered end. Inside
      // the visible span it maps one-to-one.
      const within = Math.max(0, Math.min(sourceOffset - srcFrom - lead, renderedLen))
      return renderedPos + within
    }

    renderedPos += renderedLen
  }

  // Offset is past all tokens - return end of rendered
  return lastRenderedEnd
}
