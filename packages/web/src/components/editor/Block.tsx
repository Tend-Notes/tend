// SPDX-License-Identifier: MIT WITH Commons-Clause
// Simple block component with plain contenteditable

import { useRef, useEffect, ReactNode, KeyboardEvent, MouseEvent as ReactMouseEvent, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Block } from '../../types'
import { WikiLinkPopup } from './WikiLinkPopup'
import { SlashCommandPopup, type SlashCommand } from './SlashCommandPopup'
import { SmoothCaret } from './SmoothCaret'
import { usePageStore } from '../../stores/pageStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { useSettingsStore, TASK_STATUS_SETS } from '../../stores/settingsStore'
import { useTagStore } from '../../stores/tagStore'

interface BlockProps {
  block: Block
  children?: ReactNode
  onChange: (uuid: string, content: string) => void
  onCreateBlock: (afterUuid: string, contentForNewBlock?: string) => string | undefined
  onDeleteBlock: (uuid: string) => void
  onIndent: (uuid: string) => void
  onOutdent: (uuid: string) => void
  onToggleCollapse: (uuid: string) => void
  onMergeWithPrevious: (uuid: string) => void
  onNavigateUp: (uuid: string, cursorOffset?: number) => void
  onNavigateDown: (uuid: string, cursorOffset?: number) => void
  onMoveBlockUp: (uuid: string) => void
  onMoveBlockDown: (uuid: string) => void
  onPasteBlocks: (afterUuid: string) => void
  flatBlockOrder: string[]
  readonly?: boolean
}

// Wiki-link state for autocomplete popup
interface WikiLinkState {
  active: boolean
  query: string
  startOffset: number
  position: { top: number; left: number }
}

// Configuration for bracket hiding (will be moved to a settings store later)
const HIDE_WIKI_LINK_BRACKETS = true

// Build regex to match task status keywords at start of block
function buildTaskStatusRegex(): RegExp {
  // Collect all keywords from all status sets
  const allKeywords = Object.values(TASK_STATUS_SETS).flatMap(statuses =>
    statuses.map(s => s.keyword)
  )
  // Deduplicate
  const uniqueKeywords = [...new Set(allKeywords)]
  // Match at start of content, followed by whitespace or end
  return new RegExp(`^(${uniqueKeywords.join('|')})(?:\\s|$)`)
}


// Helper to escape HTML special characters
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Formatting patterns - order matters (longer patterns first for ** vs *)
interface FormatPattern {
  key: string           // Trigger key
  delimiter: string     // The delimiter string (e.g., "**", "*", "~~")
  className: string     // CSS class for styled span
  regex: RegExp         // Regex to match formatted text
  hideDelimiters: boolean // Whether to hide delimiters when not focused
}

const FORMAT_PATTERNS: FormatPattern[] = [
  // Bold Italic: ***text*** (must come before bold and italic)
  // Requires trailing boundary (whitespace, punctuation, or end of string)
  { key: '*', delimiter: '***', className: 'fmt-bold fmt-italic', regex: /\*\*\*([^*]+)\*\*\*(?=\s|[.,;:!?)\]}>]|$)/g, hideDelimiters: true },
  // Bold: **text** (must come before italic)
  { key: '*', delimiter: '**', className: 'fmt-bold', regex: /(?<!\*)\*\*([^*]+)\*\*(?!\*)(?=\s|[.,;:!?)\]}>]|$)/g, hideDelimiters: true },
  // Italic: *text* (but not if preceded/followed by another *)
  { key: '*', delimiter: '*', className: 'fmt-italic', regex: /(?<!\*)\*([^*]+)\*(?!\*)(?=\s|[.,;:!?)\]}>]|$)/g, hideDelimiters: true },
  // Strikethrough: ~~text~~
  { key: '~', delimiter: '~~', className: 'fmt-strikethrough', regex: /~~([^~]+)~~(?=\s|[.,;:!?)\]}>]|$)/g, hideDelimiters: true },
  // Underline: __text__
  { key: '_', delimiter: '__', className: 'fmt-underline', regex: /__([^_]+)__(?=\s|[.,;:!?)\]}>]|$)/g, hideDelimiters: true },
  // Highlight: ==text==
  { key: '=', delimiter: '==', className: 'fmt-highlight', regex: /==([^=]+)==(?=\s|[.,;:!?)\]}>]|$)/g, hideDelimiters: true },
]

// Detect heading level from content (1-4, or 0 if not a heading)
// Matches: "# Heading", "## Heading", etc.
function getHeadingLevel(content: string): number {
  const match = content.match(/^(#{1,4})\s/)
  return match ? match[1].length : 0
}

// Track pending format wraps (for selection + delimiter typing)
interface PendingFormatWrap {
  text: string
  insertPos: number
  time: number
  delimiter: string
  charCount: number // How many delimiter chars typed so far
  before: string    // Content before the selection
  after: string     // Content after the selection
}

export function BlockComponent({
  block,
  children,
  onChange,
  onCreateBlock,
  onIndent,
  onOutdent,
  onToggleCollapse,
  onMergeWithPrevious,
  onNavigateUp,
  onNavigateDown,
  onMoveBlockUp,
  onMoveBlockDown,
  onPasteBlocks,
  flatBlockOrder,
  readonly = false,
}: BlockProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const lastContentRef = useRef(block.content)
  const navigateToPage = usePageStore((state) => state.navigateToPage)
  const taskStatuses = useSettingsStore((state) => state.getTaskStatuses())
  const getTagColor = useTagStore((state) => state.getTagColor)

  // Helper to get fresh flat block order from page store
  // This is needed because the flatBlockOrder prop may be stale after state updates (e.g., after Enter creates a new block)
  const getFreshFlatBlockOrder = useCallback((): string[] => {
    const page = usePageStore.getState().currentPage
    if (!page) return []
    const result: string[] = []
    const traverse = (uuids: string[]) => {
      for (const uuid of uuids) {
        const block = page.blocks[uuid]
        if (block) {
          result.push(uuid)
          if (!block.collapsed && block.children.length > 0) {
            traverse(block.children)
          }
        }
      }
    }
    traverse(page.rootBlocks)
    return result
  }, [])

  // Selection state
  const { setFocusedBlock, startSelection, extendSelection, extendSelectionInDirection, clearSelection, isInSelection, startDrag, hasMultiBlockSelection } = useSelectionStore()
  const isDragging = useSelectionStore((state) => state.isDragging)
  const isSelected = isInSelection(block.uuid, flatBlockOrder)

  // Wiki-link autocomplete state
  const [wikiLink, setWikiLink] = useState<WikiLinkState>({
    active: false,
    query: '',
    startOffset: 0,
    position: { top: 0, left: 0 },
  })

  // Slash command state
  const [slashCommand, setSlashCommand] = useState<{
    active: boolean
    query: string
    startOffset: number
    position: { top: number; left: number }
  }>({
    active: false,
    query: '',
    startOffset: 0,
    position: { top: 0, left: 0 },
  })

  // Track cursor position for showing brackets when inside a wiki-link
  const [cursorInWikiLink, setCursorInWikiLink] = useState<{
    start: number
    end: number
  } | null>(null)

  // Context menu state for bullet right-click
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
  } | null>(null)

  // Track if this block's editor has focus (for smooth caret)
  const [isEditorFocused, setIsEditorFocused] = useState(false)

  // Render content with wiki-link and formatting highlighting
  // cursorOffset indicates cursor position for showing delimiters when inside formatted text
  const renderContent = useCallback((content: string, cursorRange: { start: number; end: number } | null): string => {
    // First, collect all formatting spans with their positions
    interface Span {
      start: number
      end: number
      type: 'wiki-link' | 'format' | 'heading-marker' | 'task-status' | 'tag'
      className: string
      innerText: string
      delimiter?: string
      pageName?: string
      taskKeyword?: string
      taskColor?: string
      tagName?: string
      tagColor?: string
    }

    const spans: Span[] = []

    // Check for task status at start (TODO, DOING, DONE, etc.)
    const taskStatusRegex = buildTaskStatusRegex()
    const taskMatch = content.match(taskStatusRegex)
    if (taskMatch) {
      const keyword = taskMatch[1]
      // Find the color for this keyword from any status set
      let color = 'base-05' // default
      for (const statuses of Object.values(TASK_STATUS_SETS)) {
        const status = statuses.find(s => s.keyword === keyword)
        if (status) {
          color = status.color
          break
        }
      }
      spans.push({
        start: 0,
        end: keyword.length,
        type: 'task-status',
        className: `task-status task-status--${keyword.toLowerCase()}`,
        innerText: keyword,
        taskKeyword: keyword,
        taskColor: color,
      })
    }

    // Check for heading marker at start (# , ## , etc.) - but not if there's a task status
    const headingMatch = content.match(/^(#{1,4})\s/)
    if (headingMatch && !taskMatch) {
      spans.push({
        start: 0,
        end: headingMatch[0].length,
        type: 'heading-marker',
        className: 'heading-marker',
        innerText: headingMatch[0],
      })
    }

    // Find wiki-links - require trailing boundary (whitespace, punctuation, or end of string)
    const wikiRegex = /\[\[([^\]]+)\]\](?=\s|[.,;:!?)\]}>]|$)/g
    let match
    while ((match = wikiRegex.exec(content)) !== null) {
      spans.push({
        start: match.index,
        end: match.index + match[0].length,
        type: 'wiki-link',
        className: 'wiki-link',
        innerText: match[1],
        delimiter: '[[',
        pageName: match[1],
      })
    }

    // Find format patterns
    for (const pattern of FORMAT_PATTERNS) {
      const regex = new RegExp(pattern.regex.source, 'g')
      while ((match = regex.exec(content)) !== null) {
        // Check for overlap with existing spans
        const start = match.index
        const end = match.index + match[0].length
        const overlaps = spans.some(s =>
          (start >= s.start && start < s.end) ||
          (end > s.start && end <= s.end) ||
          (start <= s.start && end >= s.end)
        )
        if (!overlaps) {
          spans.push({
            start,
            end,
            type: 'format',
            className: pattern.className,
            innerText: match[1],
            delimiter: pattern.delimiter,
          })
        }
      }
    }

    // Find tags (#tagname) - must be preceded by whitespace or start of string
    // AND followed by whitespace or punctuation or end of string
    // Tag names can contain letters, numbers, underscores, hyphens
    // Using a simpler regex without lookbehind for better compatibility
    const tagRegex = /(^|\s)#([a-zA-Z][a-zA-Z0-9_-]*)(?=\s|[^\w-]|$)/g
    while ((match = tagRegex.exec(content)) !== null) {
      // Adjust start position to exclude the leading whitespace if present
      const leadingSpace = match[1]
      const start = match.index + leadingSpace.length
      const end = match.index + match[0].length
      const tagName = match[2]

      // Skip tags that end at cursor position AND at end of content (user is still typing)
      // This prevents color cycling while typing a tag name
      const isAtEndOfContent = end === content.length
      const cursorAtEnd = cursorRange && cursorRange.start === end
      if (isAtEndOfContent && cursorAtEnd) {
        continue
      }

      // Check for overlap with existing spans
      const overlaps = spans.some(s =>
        (start >= s.start && start < s.end) ||
        (end > s.start && end <= s.end) ||
        (start <= s.start && end >= s.end)
      )
      if (!overlaps) {
        spans.push({
          start,
          end,
          type: 'tag',
          className: 'tag-pill',
          innerText: tagName,
          tagName,
          tagColor: getTagColor(tagName),
        })
      }
    }

    // Sort spans by start position
    spans.sort((a, b) => a.start - b.start)

    // Check if this is a completed task (DONE or NEVER at start)
    const completedKeywords = ['DONE', 'NEVER']
    const isCompletedTask = taskMatch && completedKeywords.includes(taskMatch[1])

    // Build result
    let result = ''
    let lastIndex = 0
    let afterTaskStatus = false

    for (const span of spans) {
      // Add text before this span
      const textBefore = escapeHtml(content.slice(lastIndex, span.start))
      if (textBefore) {
        if (afterTaskStatus && isCompletedTask) {
          result += `<span class="task-content-struck">${textBefore}</span>`
        } else if (afterTaskStatus) {
          // Wrap in span to prevent style inheritance from task status badge
          result += `<span class="task-content">${textBefore}</span>`
        } else {
          result += textBefore
        }
      }

      // Check if cursor is inside this span (strictly inside, not at boundaries)
      const cursorInside = cursorRange &&
        cursorRange.start > span.start &&
        cursorRange.start < span.end

      if (span.type === 'task-status') {
        // Task status marker - styled badge that's clickable to cycle
        result += `<span class="${span.className}" data-task-keyword="${escapeHtml(span.taskKeyword!)}" style="color: var(--${span.taskColor}); cursor: pointer;">${escapeHtml(span.taskKeyword!)}</span>`
        afterTaskStatus = true
      } else if (span.type === 'wiki-link') {
        let linkHtml: string
        if (HIDE_WIKI_LINK_BRACKETS && !cursorInside) {
          linkHtml = `<span class="${span.className}" data-page-name="${escapeHtml(span.pageName!)}" data-start="${span.start}" data-end="${span.end}">${escapeHtml(span.innerText)}</span>`
        } else {
          const focusClass = cursorInside ? ' wiki-link--focused' : ''
          linkHtml = `<span class="${span.className}${focusClass}" data-page-name="${escapeHtml(span.pageName!)}" data-start="${span.start}" data-end="${span.end}">[[${escapeHtml(span.innerText)}]]</span>`
        }
        if (afterTaskStatus && isCompletedTask) {
          result += `<span class="task-content-struck">${linkHtml}</span>`
        } else {
          result += linkHtml
        }
      } else if (span.type === 'heading-marker') {
        // Heading marker - always shown with subtle styling
        result += `<span class="${span.className}">${escapeHtml(span.innerText)}</span>`
      } else if (span.type === 'tag') {
        // Tag pill - styled with background color, atomic unit
        const tagHtml = `<span class="${span.className}" data-tag-name="${escapeHtml(span.tagName!)}" style="--tag-color: ${span.tagColor};">#${escapeHtml(span.tagName!)}</span>`
        if (afterTaskStatus && isCompletedTask) {
          result += `<span class="task-content-struck">${tagHtml}</span>`
        } else if (afterTaskStatus) {
          result += `<span class="task-content">${tagHtml}</span>`
        } else {
          result += tagHtml
        }
      } else {
        // Format span
        const delim = span.delimiter!
        let formatHtml: string
        if (cursorInside) {
          // Show delimiters when cursor is inside
          formatHtml = `<span class="${span.className} fmt--focused">${escapeHtml(delim)}${escapeHtml(span.innerText)}${escapeHtml(delim)}</span>`
        } else {
          // Hide delimiters
          formatHtml = `<span class="${span.className}">${escapeHtml(span.innerText)}</span>`
        }
        if (afterTaskStatus && isCompletedTask) {
          result += `<span class="task-content-struck">${formatHtml}</span>`
        } else {
          result += formatHtml
        }
      }

      lastIndex = span.end
    }

    // Add remaining text after last span
    const remainingText = escapeHtml(content.slice(lastIndex))
    if (remainingText) {
      if (afterTaskStatus && isCompletedTask) {
        result += `<span class="task-content-struck">${remainingText}</span>`
      } else if (afterTaskStatus) {
        // Wrap in span to prevent style inheritance from task status badge
        result += `<span class="task-content">${remainingText}</span>`
      } else {
        result += remainingText
      }
    }

    return result
  }, [getTagColor])

  // Sync content from props when it changes externally
  useEffect(() => {
    if (editorRef.current && block.content !== lastContentRef.current) {
      lastContentRef.current = block.content
      // Save cursor position
      const selection = window.getSelection()
      const cursorOffset = selection && editorRef.current.contains(selection.anchorNode)
        ? getCursorOffset(editorRef.current, selection)
        : null

      // Update with rendered content (pass cursor position to show brackets if inside wiki-link)
      const cursorRange = cursorOffset !== null ? { start: cursorOffset, end: cursorOffset } : null
      editorRef.current.innerHTML = renderContent(block.content, cursorRange)

      // Restore cursor if we had one
      if (cursorOffset !== null && document.activeElement === editorRef.current) {
        restoreCursor(editorRef.current, cursorOffset)
      }
    }
  }, [block.content, renderContent])

  // Initialize content on mount
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = renderContent(block.content, null)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle wiki-link clicks - use mousedown to capture before selection change triggers re-render
  useEffect(() => {
    const el = editorRef.current
    if (!el) return

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.classList.contains('wiki-link')) {
        e.preventDefault()
        e.stopPropagation()
        const pageName = target.dataset.pageName
        if (pageName) {
          navigateToPage(pageName)
        }
      }
    }

    el.addEventListener('mousedown', handleMouseDown)
    return () => el.removeEventListener('mousedown', handleMouseDown)
  }, [navigateToPage])

  // Handle task status clicks - cycle through statuses
  useEffect(() => {
    const el = editorRef.current
    if (!el || readonly) return

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.dataset.taskKeyword) {
        e.preventDefault()
        e.stopPropagation()

        const currentKeyword = target.dataset.taskKeyword
        // Find current position in task statuses array
        const currentIndex = taskStatuses.findIndex(s => s.keyword === currentKeyword)

        if (currentIndex !== -1) {
          // Cycle to next status (wrap around)
          const nextIndex = (currentIndex + 1) % taskStatuses.length
          const nextKeyword = taskStatuses[nextIndex].keyword

          // Replace the keyword in content
          const newContent = block.content.replace(
            new RegExp(`^${currentKeyword}(?=\\s|$)`),
            nextKeyword
          )

          if (newContent !== block.content) {
            lastContentRef.current = newContent
            onChange(block.uuid, newContent)

            // Immediately re-render with new content (don't wait for React cycle)
            el.innerHTML = renderContent(newContent, null)
          }
        }
      }
    }

    el.addEventListener('click', handleClick)
    return () => el.removeEventListener('click', handleClick)
  }, [block.uuid, block.content, taskStatuses, onChange, readonly, renderContent])

  // Handle tag clicks - navigate to tag page
  useEffect(() => {
    const el = editorRef.current
    if (!el) return

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.classList.contains('tag-pill')) {
        e.preventDefault()
        e.stopPropagation()
        const tagName = target.dataset.tagName
        if (tagName) {
          // Navigate to tag page
          window.history.pushState({ type: 'tag', name: tagName }, '', `/tags/${encodeURIComponent(tagName)}`)
          // TODO: Implement tag page view - for now just navigate
          navigateToPage(`tags/${tagName}`)
        }
      }
    }

    el.addEventListener('click', handleClick)
    return () => el.removeEventListener('click', handleClick)
  }, [navigateToPage])

  // Track cursor position to show/hide delimiters (wiki-links and formatting)
  useEffect(() => {
    const el = editorRef.current
    if (!el) return

    const handleSelectionChange = () => {
      // Skip this event if we're explicitly jumping out of a span
      if (skipNextSelectionChangeRef.current) {
        skipNextSelectionChangeRef.current = false
        return
      }

      const selection = window.getSelection()
      if (!selection || !el.contains(selection.anchorNode)) {
        // Cursor not in this block
        if (cursorInWikiLink !== null) {
          setCursorInWikiLink(null)
          // Re-render without cursor focus - but only if content actually needs to change
          // Use lastContentRef to avoid race condition with handleInput
          const newHtml = renderContent(lastContentRef.current, null)
          if (el.innerHTML !== newHtml) {
            el.innerHTML = newHtml
          }
        }
        return
      }

      // Get DOM cursor offset (in displayed text)
      const domCursorOffset = getCursorOffset(el, selection)
      // Use lastContentRef instead of block.content to avoid race condition
      // handleInput updates lastContentRef synchronously, but block.content prop
      // may not have updated yet from the React state update
      const content = lastContentRef.current

      // Convert DOM offset to content offset by accounting for hidden delimiters
      // When delimiters are hidden, DOM text is shorter than content
      const contentCursorOffset = domOffsetToContentOffset(content, domCursorOffset, cursorInWikiLink)

      // Find if cursor is strictly inside any wiki-link or formatted span
      // Use exclusive end boundary (< end, not <= end) to avoid "capturing" cursor after the span
      let foundSpan: { start: number; end: number } | null = null

      // Check wiki-links
      const wikiRegex = /\[\[([^\]]+)\]\]/g
      let match
      while ((match = wikiRegex.exec(content)) !== null) {
        const start = match.index
        const end = match.index + match[0].length
        // Cursor must be strictly inside: after start, before end
        if (contentCursorOffset > start && contentCursorOffset < end) {
          foundSpan = { start, end }
          break
        }
      }

      // Check format patterns
      if (!foundSpan) {
        for (const pattern of FORMAT_PATTERNS) {
          const regex = new RegExp(pattern.regex.source, 'g')
          while ((match = regex.exec(content)) !== null) {
            const start = match.index
            const end = match.index + match[0].length
            // Cursor must be strictly inside: after start, before end
            if (contentCursorOffset > start && contentCursorOffset < end) {
              foundSpan = { start, end }
              break
            }
          }
          if (foundSpan) break
        }
      }

      // Only update if the focus changed
      const currentStart = cursorInWikiLink?.start ?? -1
      const currentEnd = cursorInWikiLink?.end ?? -1
      const newStart = foundSpan?.start ?? -1
      const newEnd = foundSpan?.end ?? -1

      if (currentStart !== newStart || currentEnd !== newEnd) {
        setCursorInWikiLink(foundSpan)
        // Re-render with new cursor focus - compare first to avoid flicker
        const newHtml = renderContent(content, foundSpan ? { start: contentCursorOffset, end: contentCursorOffset } : null)
        if (el.innerHTML !== newHtml) {
          el.innerHTML = newHtml
          // Convert content offset to new DOM offset after re-render
          // The DOM structure changed (delimiters shown/hidden), so we need to recalculate
          const newDomOffset = contentOffsetToDomOffset(content, contentCursorOffset, foundSpan)
          restoreCursor(el, newDomOffset)
        }
      }
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [block.content, cursorInWikiLink, renderContent])

  // Check for wiki-link trigger pattern
  const checkWikiLinkTrigger = useCallback(() => {
    const el = editorRef.current
    if (!el) return

    const selection = window.getSelection()
    if (!selection || !selection.isCollapsed) return

    const cursorOffset = getCursorOffset(el, selection)
    const content = el.textContent || ''

    // Look for [[ before cursor that isn't closed
    const beforeCursor = content.substring(0, cursorOffset)
    const lastOpenBracket = beforeCursor.lastIndexOf('[[')

    if (lastOpenBracket !== -1) {
      const afterOpen = beforeCursor.substring(lastOpenBracket + 2)
      // Check if there's a closing ]] between [[ and cursor
      if (!afterOpen.includes(']]')) {
        // We're inside a wiki-link - get popup position
        const range = selection.getRangeAt(0)
        const rect = range.getBoundingClientRect()

        setWikiLink({
          active: true,
          query: afterOpen,
          startOffset: lastOpenBracket,
          position: {
            top: rect.bottom + window.scrollY + 4,
            left: rect.left + window.scrollX,
          },
        })
        return
      }
    }

    // No active wiki-link - close popup
    if (wikiLink.active) {
      setWikiLink((prev) => ({ ...prev, active: false }))

      // If we just completed a wiki-link (typed ]])), re-render to show styled version
      const cursorRange = { start: cursorOffset, end: cursorOffset }
      if (el.innerHTML !== renderContent(content, cursorRange)) {
        const cursorPos = cursorOffset
        el.innerHTML = renderContent(content, cursorRange)
        restoreCursor(el, cursorPos)
      }
    }
  }, [wikiLink.active, renderContent])

  // Check for slash command trigger pattern
  const checkSlashCommandTrigger = useCallback(() => {
    const el = editorRef.current
    if (!el) return

    const selection = window.getSelection()
    if (!selection || !selection.isCollapsed) return

    const cursorOffset = getCursorOffset(el, selection)
    const content = el.textContent || ''

    // Look for / at start of block or after whitespace
    const beforeCursor = content.substring(0, cursorOffset)

    // Find the last / that could start a slash command
    // It must be at position 0 or after whitespace
    let slashPos = -1
    for (let i = beforeCursor.length - 1; i >= 0; i--) {
      if (beforeCursor[i] === '/') {
        // Check if at start or after whitespace
        if (i === 0 || /\s/.test(beforeCursor[i - 1])) {
          slashPos = i
          break
        }
      } else if (/\s/.test(beforeCursor[i])) {
        // Hit whitespace without finding /, stop searching
        break
      }
    }

    if (slashPos !== -1) {
      const query = beforeCursor.substring(slashPos + 1)
      // Only show popup if query is short (command search)
      if (query.length <= 20 && !/\s/.test(query)) {
        const range = selection.getRangeAt(0)
        const rect = range.getBoundingClientRect()

        setSlashCommand({
          active: true,
          query,
          startOffset: slashPos,
          position: {
            top: rect.bottom + window.scrollY + 4,
            left: rect.left + window.scrollX - (query.length * 8), // Offset left to align with /
          },
        })
        return
      }
    }

    // No active slash command - close popup
    if (slashCommand.active) {
      setSlashCommand((prev) => ({ ...prev, active: false }))
    }
  }, [slashCommand.active])

  // Handle slash command selection
  const handleSlashCommandSelect = useCallback((command: SlashCommand) => {
    const el = editorRef.current
    if (!el) return

    const content = el.textContent || ''
    const cursorOffset = getCursorOffset(el, window.getSelection()!)

    // Remove the /query from content
    const before = content.substring(0, slashCommand.startOffset)
    const after = content.substring(cursorOffset)

    // Close popup first
    setSlashCommand((prev) => ({ ...prev, active: false }))

    // Execute the command action with context
    const context = {
      contentBefore: before,
      contentAfter: after,
      replaceContent: (newContent: string) => {
        lastContentRef.current = newContent
        onChange(block.uuid, newContent)
        requestAnimationFrame(() => {
          if (editorRef.current) {
            editorRef.current.innerHTML = renderContent(newContent, null)
            restoreCursor(editorRef.current, newContent.length)
            editorRef.current.focus()
          }
        })
      },
      insertContent: (insert: string) => {
        const newContent = before + insert + after
        lastContentRef.current = newContent
        onChange(block.uuid, newContent)
        requestAnimationFrame(() => {
          if (editorRef.current) {
            const cursorPos = before.length + insert.length
            editorRef.current.innerHTML = renderContent(newContent, { start: cursorPos, end: cursorPos })
            restoreCursor(editorRef.current, cursorPos)
            editorRef.current.focus()
          }
        })
      },
    }

    command.action(context)
  }, [slashCommand.startOffset, block.uuid, onChange, renderContent])

  const handleSlashCommandClose = useCallback(() => {
    setSlashCommand((prev) => ({ ...prev, active: false }))
  }, [])

  const handleInput = () => {
    if (editorRef.current) {
      // Get DOM text (may have hidden delimiters if elements are rendered)
      const domText = editorRef.current.textContent || ''
      const selection = window.getSelection()
      const domCursorOffset = selection ? getCursorOffset(editorRef.current, selection) : domText.length

      // Reconstruct the raw content (with delimiters) from DOM text
      // This handles the case where delimiters are hidden (e.g., ***test*** shows as "test")
      const content = reconstructContentFromDom(lastContentRef.current, domText)

      // Markup only renders when followed by whitespace/punctuation (via regex lookahead)
      // so partial patterns like [[test] or **test* stay as plain text until completed
      {
        // Check if we need to re-render for task status
        const taskStatusRegex = buildTaskStatusRegex()
        const hasTaskStatus = taskStatusRegex.test(content)
        const displayedHasTaskStatus = editorRef.current.querySelector('.task-status') !== null

        // Check if we need to re-render for tags (only complete tags followed by space/punctuation/end)
        const tagRegex = /(^|\s)#([a-zA-Z][a-zA-Z0-9_-]*)(?=\s|[^\w-]|$)/g
        const hasTag = tagRegex.test(content)
        const displayedHasTag = editorRef.current.querySelector('.tag-pill') !== null

        // Check if we need to re-render for wiki-links (with boundary check including end-of-string)
        const hasWikiLink = /\[\[[^\]]+\]\](?=\s|[.,;:!?)\]}>]|$)/.test(content)
        const displayedHasWikiLink = editorRef.current.querySelector('.wiki-link') !== null

        // Check if we need to re-render for formatting (bold, italic, etc.)
        // FORMAT_PATTERNS already have boundary lookaheads, but we need fresh regex instances
        const hasFormatting = FORMAT_PATTERNS.some(p => {
          const freshRegex = new RegExp(p.regex.source, p.regex.flags)
          return freshRegex.test(content)
        })
        const displayedHasFormatting = editorRef.current.querySelector('.fmt-bold, .fmt-italic, .fmt-strikethrough, .fmt-underline, .fmt-highlight') !== null

        // Re-render ONLY if any styled element appeared or disappeared
        // We should NOT re-render on every keystroke when elements exist
        // The DOM is contenteditable and handles text changes natively
        const needsRerender =
          hasTaskStatus !== displayedHasTaskStatus ||
          hasTag !== displayedHasTag ||
          hasWikiLink !== displayedHasWikiLink ||
          hasFormatting !== displayedHasFormatting

        if (needsRerender) {
          // When formatting disappears (delimiters become visible), the DOM cursor offset
          // was relative to the OLD DOM (with hidden delimiters). We need to convert it
          // using the PREVIOUS content state, not the new one.
          const previousContent = lastContentRef.current
          const contentCursorOffset = domOffsetToContentOffset(previousContent, domCursorOffset, null)

          editorRef.current.innerHTML = renderContent(content, null) // null = not focused inside any span

          // Convert content offset to new DOM offset (now with hidden delimiters)
          const newDomOffset = contentOffsetToDomOffset(content, contentCursorOffset, null)
          restoreCursor(editorRef.current, Math.min(newDomOffset, (editorRef.current.textContent || '').length))
        }
      }

      if (content !== lastContentRef.current) {
        lastContentRef.current = content
        onChange(block.uuid, content)
      }
      // Check for wiki-link trigger
      checkWikiLinkTrigger()
      // Check for slash command trigger
      checkSlashCommandTrigger()
    }
  }

  // Handle wiki-link selection from popup
  const handleWikiLinkSelect = useCallback((pageName: string) => {
    const el = editorRef.current
    if (!el) return

    const content = el.textContent || ''
    // Replace the partial wiki-link with the complete one
    const before = content.substring(0, wikiLink.startOffset)
    const cursorOffset = getCursorOffset(el, window.getSelection()!)
    const after = content.substring(cursorOffset)

    const newContent = `${before}[[${pageName}]]${after}`
    lastContentRef.current = newContent
    onChange(block.uuid, newContent)

    // Close popup
    setWikiLink((prev) => ({ ...prev, active: false }))

    // Update display and set cursor after the wiki-link
    requestAnimationFrame(() => {
      if (editorRef.current) {
        // Content offset is after the full [[pageName]]
        const contentCursorPos = before.length + 4 + pageName.length // [[ + name + ]]
        // Convert to DOM offset (brackets are hidden)
        const domCursorPos = contentOffsetToDomOffset(newContent, contentCursorPos, null)
        // Cursor is after the wiki-link, so no brackets to show
        editorRef.current.innerHTML = renderContent(newContent, null)
        restoreCursor(editorRef.current, domCursorPos)
        editorRef.current.focus()
      }
    })
  }, [wikiLink.startOffset, onChange, renderContent])

  const handleWikiLinkClose = useCallback(() => {
    setWikiLink((prev) => ({ ...prev, active: false }))
  }, [])

  // Track selected text when '[' is typed, to wrap with [[]] on second '['
  const pendingWikiWrapRef = useRef<{ text: string; insertPos: number; time: number } | null>(null)

  // Flag to skip next selectionchange event (used when explicitly jumping out of a span)
  const skipNextSelectionChangeRef = useRef(false)

  // Track selected text for format wrapping (e.g., * for italic, ** for bold)
  const pendingFormatWrapRef = useRef<PendingFormatWrap | null>(null)

  // Apply formatting to selected text or toggle at cursor
  const applyFormatting = useCallback((delimiter: string) => {
    const el = editorRef.current
    if (!el) return

    const selection = window.getSelection()
    if (!selection) return

    // Use block.content (raw content) not el.textContent (displayed text with hidden delimiters)
    const content = block.content

    // Get cursor/selection position in DOM, then convert to content offset
    const domCursorOffset = getCursorOffset(el, selection)
    const contentCursorOffset = domOffsetToContentOffset(content, domCursorOffset, cursorInWikiLink)

    // Find the format pattern for this delimiter
    const pattern = FORMAT_PATTERNS.find(p => p.delimiter === delimiter)
    if (!pattern) return

    // Check if cursor/selection is inside existing formatting with this delimiter
    const regex = new RegExp(pattern.regex.source, 'g')
    let match
    let insideFormatSpan: { start: number; end: number; innerText: string } | null = null

    while ((match = regex.exec(content)) !== null) {
      const start = match.index
      const end = match.index + match[0].length
      if (contentCursorOffset > start && contentCursorOffset < end) {
        insideFormatSpan = { start, end, innerText: match[1] }
        break
      }
    }

    if (insideFormatSpan) {
      // Already formatted - remove the formatting (toggle off)
      const before = content.substring(0, insideFormatSpan.start)
      const after = content.substring(insideFormatSpan.end)
      const newContent = `${before}${insideFormatSpan.innerText}${after}`

      lastContentRef.current = newContent
      onChange(block.uuid, newContent)

      // Position cursor at same relative position within the unformatted text
      const offsetIntoSpan = contentCursorOffset - insideFormatSpan.start - delimiter.length
      const newContentCursorPos = insideFormatSpan.start + Math.max(0, offsetIntoSpan)
      const domCursorPos = contentOffsetToDomOffset(newContent, newContentCursorPos, null)

      requestAnimationFrame(() => {
        if (editorRef.current) {
          editorRef.current.innerHTML = renderContent(newContent, null)
          restoreCursor(editorRef.current, domCursorPos)
          editorRef.current.focus()
        }
      })
      return
    }

    if (!selection.isCollapsed) {
      // Text is selected - wrap it with delimiter
      const selectedText = selection.toString()
      const range = selection.getRangeAt(0)
      const preSelectionRange = range.cloneRange()
      preSelectionRange.selectNodeContents(el)
      preSelectionRange.setEnd(range.startContainer, range.startOffset)
      const domSelectionStart = preSelectionRange.toString().length
      const contentSelectionStart = domOffsetToContentOffset(content, domSelectionStart, cursorInWikiLink)
      const contentSelectionEnd = contentSelectionStart + selectedText.length

      const before = content.substring(0, contentSelectionStart)
      const after = content.substring(contentSelectionEnd)

      const newContent = `${before}${delimiter}${selectedText}${delimiter}${after}`
      lastContentRef.current = newContent
      onChange(block.uuid, newContent)

      // Position cursor after the formatted text
      const contentCursorPos = before.length + delimiter.length + selectedText.length + delimiter.length
      const domCursorPos = contentOffsetToDomOffset(newContent, contentCursorPos, null)

      requestAnimationFrame(() => {
        if (editorRef.current) {
          editorRef.current.innerHTML = renderContent(newContent, null)
          restoreCursor(editorRef.current, domCursorPos)
          editorRef.current.focus()
        }
      })
    } else {
      // No selection - insert delimiter pair and place cursor between
      const before = content.substring(0, contentCursorOffset)
      const after = content.substring(contentCursorOffset)

      const newContent = `${before}${delimiter}${delimiter}${after}`
      lastContentRef.current = newContent
      onChange(block.uuid, newContent)

      // Position cursor between the delimiters
      const contentCursorPos = before.length + delimiter.length
      const domCursorPos = contentOffsetToDomOffset(newContent, contentCursorPos, null)

      requestAnimationFrame(() => {
        if (editorRef.current) {
          editorRef.current.innerHTML = renderContent(newContent, null)
          restoreCursor(editorRef.current, domCursorPos)
          editorRef.current.focus()
        }
      })
    }
  }, [block.uuid, block.content, cursorInWikiLink, onChange, renderContent])

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = editorRef.current
    if (!el) return

    // Keyboard shortcuts for formatting (Alt+Shift + key)
    // Use e.code for physical key (macOS Alt produces special characters with e.key)
    if (e.altKey && e.shiftKey) {
      switch (e.code) {
        case 'KeyB': // Bold
          e.preventDefault()
          applyFormatting('**')
          return
        case 'KeyI': // Italic
          e.preventDefault()
          applyFormatting('*')
          return
        case 'KeyU': // Underline
          e.preventDefault()
          applyFormatting('__')
          return
        case 'KeyS': // Strikethrough
          e.preventDefault()
          applyFormatting('~~')
          return
        case 'KeyH': // Highlight
          e.preventDefault()
          applyFormatting('==')
          return
      }
    }

    // Check for format pattern keys (*, ~, _, =)
    const formatPattern = FORMAT_PATTERNS.find(p => p.key === e.key)
    if (formatPattern) {
      const selection = window.getSelection()
      const now = Date.now()

      // Check if we're continuing a pending format wrap
      if (pendingFormatWrapRef.current &&
          now - pendingFormatWrapRef.current.time < 2000) {

        const pending = pendingFormatWrapRef.current
        const nextCharCount = pending.charCount + 1

        // Find the format pattern that matches this delimiter length
        const matchingPattern = FORMAT_PATTERNS.find(p =>
          p.key === e.key && p.delimiter === e.key.repeat(nextCharCount)
        )

        // Check if there's a longer pattern we could still reach
        const longerPatternExists = FORMAT_PATTERNS.some(p =>
          p.key === e.key && p.delimiter.length > nextCharCount
        )

        if (matchingPattern) {
          // Complete the format wrap
          e.preventDefault()

          // Build the formatted content
          // pending.before and pending.after were saved when we started
          const newContent = `${pending.before}${matchingPattern.delimiter}${pending.text}${matchingPattern.delimiter}${pending.after}`
          lastContentRef.current = newContent
          onChange(block.uuid, newContent)

          // Calculate new cursor position (after the formatted text) - this is content offset
          const contentCursorPos = pending.before.length + matchingPattern.delimiter.length + pending.text.length + matchingPattern.delimiter.length
          // Convert to DOM offset (delimiters are hidden)
          const domCursorPos = contentOffsetToDomOffset(newContent, contentCursorPos, null)

          // Update display
          requestAnimationFrame(() => {
            if (editorRef.current) {
              editorRef.current.innerHTML = renderContent(newContent, null)
              // Skip next selectionchange to prevent re-decoration pulling cursor back into span
              skipNextSelectionChangeRef.current = true
              restoreCursor(editorRef.current, domCursorPos)
              editorRef.current.focus()
            }
          })

          // If there's a longer pattern, keep pending state to allow "upgrading"
          if (longerPatternExists) {
            pendingFormatWrapRef.current = {
              ...pending,
              charCount: nextCharCount,
              time: now,
            }
          } else {
            pendingFormatWrapRef.current = null
          }
          return
        } else {
          // Not a complete pattern yet, just increment char count
          pendingFormatWrapRef.current = {
            ...pending,
            charCount: nextCharCount,
            time: now,
          }
          // Prevent default - we're tracking but not ready to complete
          e.preventDefault()
          return
        }
      }

      // First format key with selection - start tracking
      // IMPORTANT: Prevent default to avoid replacing selection with the typed char
      if (selection && !selection.isCollapsed) {
        e.preventDefault()

        const selectedText = selection.toString()
        const content = el.textContent || ''

        // Get selection boundaries
        const range = selection.getRangeAt(0)
        const preSelectionRange = range.cloneRange()
        preSelectionRange.selectNodeContents(el)
        preSelectionRange.setEnd(range.startContainer, range.startOffset)
        const selectionStart = preSelectionRange.toString().length
        const selectionEnd = selectionStart + selectedText.length

        // Store the before/after content so we don't lose the selected text
        const before = content.substring(0, selectionStart)
        const after = content.substring(selectionEnd)

        // Find the longest delimiter pattern for this key
        const longestPattern = FORMAT_PATTERNS
          .filter(p => p.key === e.key)
          .reduce((a, b) => a.delimiter.length > b.delimiter.length ? a : b)

        pendingFormatWrapRef.current = {
          text: selectedText,
          insertPos: selectionStart,
          time: now,
          delimiter: longestPattern.delimiter,
          charCount: 1,
          before,
          after,
        }

        // Check if single-char delimiter completes a pattern (like * for italic)
        const singleCharPattern = FORMAT_PATTERNS.find(p =>
          p.key === e.key && p.delimiter.length === 1
        )

        if (singleCharPattern) {
          // Single char delimiter - complete immediately
          const newContent = `${before}${singleCharPattern.delimiter}${selectedText}${singleCharPattern.delimiter}${after}`
          lastContentRef.current = newContent
          onChange(block.uuid, newContent)

          // Content offset after the formatted text
          const contentCursorPos = before.length + singleCharPattern.delimiter.length + selectedText.length + singleCharPattern.delimiter.length
          // Convert to DOM offset (delimiters are hidden)
          const domCursorPos = contentOffsetToDomOffset(newContent, contentCursorPos, null)

          requestAnimationFrame(() => {
            if (editorRef.current) {
              editorRef.current.innerHTML = renderContent(newContent, null)
              restoreCursor(editorRef.current, domCursorPos)
              editorRef.current.focus()
            }
          })

          // Keep pending state for potential upgrade (e.g., * -> **)
          const longerPatternExists = FORMAT_PATTERNS.some(p =>
            p.key === e.key && p.delimiter.length > 1
          )
          if (longerPatternExists) {
            pendingFormatWrapRef.current = {
              text: selectedText,
              insertPos: selectionStart,
              time: now,
              delimiter: longestPattern.delimiter,
              charCount: 1,
              before,
              after,
            }
          } else {
            pendingFormatWrapRef.current = null
          }
        }
        return
      }
    } else {
      // Any other key clears the pending format wrap
      pendingFormatWrapRef.current = null
    }

    // '[' key - check for wiki-link wrapping of selection
    if (e.key === '[') {
      const selection = window.getSelection()
      const now = Date.now()

      // Check if this is the second '[' after we stored selected text
      if (pendingWikiWrapRef.current && now - pendingWikiWrapRef.current.time < 1000) {
        e.preventDefault()
        const { text: selectedText, insertPos } = pendingWikiWrapRef.current
        const content = el.textContent || ''

        // Current content has '[' at insertPos from first keystroke
        // We need to replace that '[' with '[[selectedText]]'
        const before = content.substring(0, insertPos)
        const after = content.substring(insertPos + 1) // +1 to skip the '[' we already typed

        const wikiLink = `[[${selectedText}]]`
        const newContent = `${before}${wikiLink}${after}`
        lastContentRef.current = newContent
        onChange(block.uuid, newContent)

        // Update display and position cursor after the wiki-link
        requestAnimationFrame(() => {
          if (editorRef.current) {
            // Content offset is after the full [[text]] - i.e., before.length + wikiLink.length
            const contentCursorPos = before.length + wikiLink.length
            // Convert to DOM offset (brackets are hidden)
            const domCursorPos = contentOffsetToDomOffset(newContent, contentCursorPos, null)
            // Cursor is after the wiki-link, so no brackets to show
            editorRef.current.innerHTML = renderContent(newContent, null)
            // Skip next selectionchange to prevent re-decoration pulling cursor back into span
            skipNextSelectionChangeRef.current = true
            restoreCursor(editorRef.current, domCursorPos)
            editorRef.current.focus()
          }
        })

        pendingWikiWrapRef.current = null
        return
      }

      // First '[' with selection - remember the selected text
      if (selection && !selection.isCollapsed) {
        const selectedText = selection.toString()

        // Get selection start position
        const range = selection.getRangeAt(0)
        const preSelectionRange = range.cloneRange()
        preSelectionRange.selectNodeContents(el)
        preSelectionRange.setEnd(range.startContainer, range.startOffset)
        const selectionStart = preSelectionRange.toString().length

        // Let the '[' be typed (replaces selection), but remember for second '['
        pendingWikiWrapRef.current = {
          text: selectedText,
          insertPos: selectionStart,
          time: now,
        }
      } else {
        pendingWikiWrapRef.current = null
      }
    } else {
      // Any other key clears the pending wiki wrap
      pendingWikiWrapRef.current = null
    }

    // Enter - create new block (split content at cursor)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()

      // Get cursor position in DOM, then convert to raw content position
      // This is critical because the DOM may have hidden delimiters (e.g., [[ ]] for wiki-links)
      const selection = window.getSelection()
      const domCursorOffset = selection ? getCursorOffset(el, selection) : 0

      // Use raw content from block.content, not el.textContent (which has hidden delimiters)
      const rawContent = block.content

      // Convert DOM offset to content offset, accounting for hidden delimiters
      const contentCursorOffset = domOffsetToContentOffset(rawContent, domCursorOffset, cursorInWikiLink)

      let contentBefore = rawContent.substring(0, contentCursorOffset)
      const contentAfter = rawContent.substring(contentCursorOffset)

      // If cursor is at the end and content ends with an un-rendered pattern that would
      // render with a boundary, add a trailing space. This handles the case where user
      // types "**bold**" and presses Enter - we want it to render as bold.
      if (contentAfter === '' && contentBefore.length > 0) {
        // Check if content ends with a pattern that would render with a trailing space
        const endsWithUnrenderedPattern =
          // Wiki-link without boundary
          /\[\[[^\]]+\]\]$/.test(contentBefore) ||
          // Bold/italic/etc without boundary - check various patterns
          /\*\*\*[^*]+\*\*\*$/.test(contentBefore) ||
          /(?<!\*)\*\*[^*]+\*\*$/.test(contentBefore) ||
          /(?<!\*)\*[^*]+\*$/.test(contentBefore) ||
          /~~[^~]+~~$/.test(contentBefore) ||
          /__[^_]+__$/.test(contentBefore) ||
          /==[^=]+==$/.test(contentBefore)

        if (endsWithUnrenderedPattern) {
          contentBefore = contentBefore + ' '
        }
      }

      // Update current block with content before cursor
      if (contentBefore !== block.content) {
        lastContentRef.current = contentBefore
        onChange(block.uuid, contentBefore)
        el.innerHTML = renderContent(contentBefore, null)
      }

      // Create new block with content after cursor
      const newUuid = onCreateBlock(block.uuid, contentAfter)
      if (newUuid) {
        // Set focused block synchronously so Shift+Arrow selection works immediately
        setFocusedBlock(newUuid)
        // Focus new block after render
        requestAnimationFrame(() => {
          const newBlockEl = document.querySelector(`[data-block-id="${newUuid}"]`)
          const newEditor = newBlockEl?.querySelector('[contenteditable]') as HTMLElement
          newEditor?.focus()
        })
      }
      return
    }

    // Backspace at start - merge with previous
    // Also handle deleting entire tags as atomic units
    // Skip if there's a multi-block selection - let OutlinerEditor handle it
    if (e.key === 'Backspace') {
      if (hasMultiBlockSelection(flatBlockOrder)) {
        // Don't handle - let the event bubble up to OutlinerEditor
        return
      }
      const selection = window.getSelection()
      if (selection && selection.isCollapsed) {
        if (isAtStart(el, selection)) {
          e.preventDefault()
          onMergeWithPrevious(block.uuid)
          return
        }

        // Check if cursor is at end of a tag - delete entire tag
        const domOffset = getCursorOffset(el, selection)
        const contentOffset = domOffsetToContentOffset(block.content, domOffset, cursorInWikiLink)
        const tagInfo = getTagAtContentOffset(block.content, contentOffset)

        if (tagInfo && contentOffset > tagInfo.start && contentOffset <= tagInfo.end) {
          // Inside or at end of a tag - delete entire tag
          e.preventDefault()
          const before = block.content.slice(0, tagInfo.start)
          const after = block.content.slice(tagInfo.end)
          const newContent = before + after
          lastContentRef.current = newContent
          onChange(block.uuid, newContent)

          // Update display and position cursor
          el.innerHTML = renderContent(newContent, null)
          restoreCursor(el, tagInfo.start)
          return
        }
      }
    }

    // Delete key - delete entire tag as atomic unit (forward delete)
    // Skip if there's a multi-block selection - let OutlinerEditor handle it
    if (e.key === 'Delete') {
      if (hasMultiBlockSelection(flatBlockOrder)) {
        // Don't handle - let the event bubble up to OutlinerEditor
        return
      }
      const selection = window.getSelection()
      if (selection && selection.isCollapsed) {
        const domOffset = getCursorOffset(el, selection)
        const contentOffset = domOffsetToContentOffset(block.content, domOffset, cursorInWikiLink)
        const tagInfo = getTagAtContentOffset(block.content, contentOffset)

        if (tagInfo && contentOffset >= tagInfo.start && contentOffset < tagInfo.end) {
          // At start of or inside a tag - delete entire tag
          e.preventDefault()
          const before = block.content.slice(0, tagInfo.start)
          const after = block.content.slice(tagInfo.end)
          const newContent = before + after
          lastContentRef.current = newContent
          onChange(block.uuid, newContent)

          // Update display and position cursor
          el.innerHTML = renderContent(newContent, null)
          restoreCursor(el, tagInfo.start)
          return
        }
      }
    }

    // Tab - indent (must check before browser handles it)
    if (e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      if (e.shiftKey) {
        onOutdent(block.uuid)
      } else {
        onIndent(block.uuid)
      }
      return
    }

    // Ctrl+V / Cmd+V - paste blocks (when no text selection, let it parse markdown)
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      const selection = window.getSelection()
      // Only intercept paste if there's no text selection (otherwise let browser handle inline paste)
      if (selection && selection.isCollapsed) {
        e.preventDefault()
        onPasteBlocks(block.uuid)
        return
      }
    }

    // Alt+Arrow Up - move block up (become child of previous block)
    if (e.key === 'ArrowUp' && e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      onMoveBlockUp(block.uuid)
      return
    }

    // Alt+Arrow Down - move block down (become sibling after next block's subtree)
    if (e.key === 'ArrowDown' && e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      onMoveBlockDown(block.uuid)
      return
    }

    // Alt+Arrow Left - outdent (same as Shift+Tab)
    if (e.key === 'ArrowLeft' && e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      onOutdent(block.uuid)
      return
    }

    // Alt+Arrow Right - indent (same as Tab)
    if (e.key === 'ArrowRight' && e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      onIndent(block.uuid)
      return
    }

    // Shift+Arrow Up - extend selection upward
    if (e.key === 'ArrowUp' && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      // Get fresh flat block order from page store (prop may be stale after Enter creates new block)
      const freshFlatOrder = getFreshFlatBlockOrder()
      extendSelectionInDirection('up', freshFlatOrder)
      return
    }

    // Shift+Arrow Down - extend selection downward
    if (e.key === 'ArrowDown' && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      // Get fresh flat block order from page store (prop may be stale after Enter creates new block)
      const freshFlatOrder = getFreshFlatBlockOrder()
      extendSelectionInDirection('down', freshFlatOrder)
      return
    }

    // Arrow Up - navigate to previous block
    // For single-line content, always navigate; for multi-line, only when at start
    if (e.key === 'ArrowUp') {
      // Clear multi-block selection when moving cursor without Shift
      clearSelection()

      const selection = window.getSelection()
      if (selection && selection.isCollapsed) {
        // Check if content is single-line or cursor is at start
        const hasLineBreaks = el.textContent?.includes('\n')
        if (!hasLineBreaks || isAtStart(el, selection)) {
          e.preventDefault()
          const cursorOffset = getCursorOffset(el, selection)
          onNavigateUp(block.uuid, cursorOffset)
          return
        }
      }
    }

    // Arrow Down - navigate to next block
    // For single-line content, always navigate; for multi-line, only when at end
    if (e.key === 'ArrowDown') {
      // Clear multi-block selection when moving cursor without Shift
      clearSelection()

      const selection = window.getSelection()
      if (selection && selection.isCollapsed) {
        const hasLineBreaks = el.textContent?.includes('\n')
        if (!hasLineBreaks || isAtEnd(el, selection)) {
          e.preventDefault()
          const cursorOffset = getCursorOffset(el, selection)
          onNavigateDown(block.uuid, cursorOffset)
          return
        }
      }
    }

    // Arrow Left at start - navigate to previous block
    // Also handle jumping over hidden delimiters at span boundaries
    if (e.key === 'ArrowLeft') {
      // Clear multi-block selection when moving cursor without Shift
      clearSelection()

      const selection = window.getSelection()
      if (selection && selection.isCollapsed) {
        // Check if at start of document
        if (isAtStart(el, selection)) {
          e.preventDefault()
          onNavigateUp(block.uuid)
          return
        }

        // Check if we need to jump over hidden delimiters (entering a span from the right)
        const domOffset = getCursorOffset(el, selection)
        const contentOffset = domOffsetToContentOffset(block.content, domOffset, cursorInWikiLink)

        // Check for tags - tags are atomic, skip over entire tag
        const tagInfo = getTagAtContentOffset(block.content, contentOffset)
        if (tagInfo && contentOffset > tagInfo.start && contentOffset <= tagInfo.end) {
          // Inside or at end of a tag - jump to start
          e.preventDefault()
          const newDomOffset = contentOffsetToDomOffset(block.content, tagInfo.start, null)
          restoreCursor(el, newDomOffset)
          return
        }

        // If we're at the end of a formatted span, jump to inside it (before closing delimiter)
        const spanInfo = getSpanAtContentOffset(block.content, contentOffset)
        if (spanInfo && contentOffset === spanInfo.end) {
          // At the end of a span - jump inside before the closing delimiter
          e.preventDefault()
          const newContentOffset = spanInfo.end - spanInfo.delimiterLength
          const newDomOffset = contentOffsetToDomOffset(block.content, newContentOffset, { start: spanInfo.start, end: spanInfo.end })
          el.innerHTML = renderContent(block.content, { start: newContentOffset, end: newContentOffset })
          restoreCursor(el, newDomOffset)
          setCursorInWikiLink({ start: spanInfo.start, end: spanInfo.end })
          return
        }
      }
    }

    // Arrow Right at end - navigate to next block
    // Also handle jumping over hidden delimiters at span boundaries
    if (e.key === 'ArrowRight') {
      // Clear multi-block selection when moving cursor without Shift
      clearSelection()

      const selection = window.getSelection()
      if (selection && selection.isCollapsed) {
        // Check if we need to jump over hidden delimiters (exiting a span)
        // This must be checked BEFORE isAtEnd, because isAtEnd uses DOM length
        // which doesn't account for hidden closing delimiters
        const domOffset = getCursorOffset(el, selection)
        const contentOffset = domOffsetToContentOffset(block.content, domOffset, cursorInWikiLink)

        // Check for tags - tags are atomic, skip over entire tag
        const tagInfo = getTagAtContentOffset(block.content, contentOffset)
        if (tagInfo && contentOffset >= tagInfo.start && contentOffset < tagInfo.end) {
          // Inside or at start of a tag - jump to end
          e.preventDefault()
          const newDomOffset = contentOffsetToDomOffset(block.content, tagInfo.end, null)
          restoreCursor(el, newDomOffset)
          return
        }

        // If we're inside a formatted span (delimiters visible), check if we're at the true end
        if (cursorInWikiLink) {
          if (contentOffset >= cursorInWikiLink.end - 1) {
            // At or past the last character of the span - exit and strip delimiters
            // Move one past the span end for visual continuity
            e.preventDefault()
            const newContentOffset = Math.min(cursorInWikiLink.end + 1, block.content.length)
            const newDomOffset = contentOffsetToDomOffset(block.content, newContentOffset, null)
            el.innerHTML = renderContent(block.content, null)
            // Skip the next selectionchange to prevent re-decoration
            skipNextSelectionChangeRef.current = true
            restoreCursor(el, newDomOffset)
            setCursorInWikiLink(null)
            return
          }
          // Otherwise, let browser handle normal navigation through the visible delimiters
        } else {
          // Not tracking a focused span, but we might be at the end of one's visible text
          // (e.g., cursor placed there after wiki-link wrap without entering the span)
          // In this case, show the delimiters first (like ArrowLeft does when entering)
          const spanInfo = getSpanAtContentOffset(block.content, contentOffset)
          if (spanInfo) {
            const innerEnd = spanInfo.end - spanInfo.delimiterLength
            if (contentOffset >= innerEnd) {
              // At the inner end - show delimiters and position cursor before closing delimiter
              // This mirrors ArrowLeft behavior: show delimiters, let user navigate through
              e.preventDefault()
              const newContentOffset = innerEnd
              const newDomOffset = contentOffsetToDomOffset(block.content, newContentOffset, { start: spanInfo.start, end: spanInfo.end })
              el.innerHTML = renderContent(block.content, { start: newContentOffset, end: newContentOffset })
              restoreCursor(el, newDomOffset)
              setCursorInWikiLink({ start: spanInfo.start, end: spanInfo.end })
              return
            }
          }
        }

        // Check if at end of content (after handling any span boundaries)
        // Use content offset comparison since DOM length doesn't include hidden delimiters
        if (contentOffset >= block.content.length) {
          e.preventDefault()
          onNavigateDown(block.uuid)
          return
        }
      }
    }
  }

  // Helper: get span info at a content offset
  // Returns span info if offset is AT or INSIDE the span (not after it)
  // Only considers "rendered" spans (those with hidden delimiters), i.e., with trailing boundary
  function getSpanAtContentOffset(content: string, offset: number): { start: number; end: number; delimiterLength: number } | null {
    // Check wiki-links - use boundary-aware regex (only rendered wiki-links)
    const wikiRegex = /\[\[([^\]]+)\]\](?=\s|[.,;:!?)\]}>]|$)/g
    let match
    while ((match = wikiRegex.exec(content)) !== null) {
      // offset < end (not <=) because position == end means AFTER the span
      if (offset >= match.index && offset < match.index + match[0].length) {
        return { start: match.index, end: match.index + match[0].length, delimiterLength: 2 }
      }
    }

    // Check format patterns (already have boundary lookaheads)
    for (const pattern of FORMAT_PATTERNS) {
      const regex = new RegExp(pattern.regex.source, 'g')
      while ((match = regex.exec(content)) !== null) {
        // offset < end (not <=) because position == end means AFTER the span
        if (offset >= match.index && offset < match.index + match[0].length) {
          return { start: match.index, end: match.index + match[0].length, delimiterLength: pattern.delimiter.length }
        }
      }
    }

    return null
  }

  // Helper: get tag info at a content offset (tags are fully atomic, no inner content)
  function getTagAtContentOffset(content: string, offset: number): { start: number; end: number } | null {
    // Using a simpler regex without lookbehind for better compatibility
    // Tags must be followed by whitespace or punctuation or end of string
    const tagRegex = /(^|\s)#([a-zA-Z][a-zA-Z0-9_-]*)(?=\s|[^\w-]|$)/g
    let match
    while ((match = tagRegex.exec(content)) !== null) {
      // Adjust start position to exclude the leading whitespace if present
      const leadingSpace = match[1]
      const start = match.index + leadingSpace.length
      const end = match.index + match[0].length
      // offset <= end because we want to detect when cursor is AT the end too (to skip on arrow right)
      if (offset >= start && offset <= end) {
        return { start, end }
      }
    }
    return null
  }

  const hasChildren = block.children.length > 0

  // Handle bullet right-click context menu
  const handleBulletContextMenu = useCallback((e: ReactMouseEvent) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  // Copy block ID to clipboard
  const handleCopyBlockId = useCallback(() => {
    navigator.clipboard.writeText(block.uuid)
    setContextMenu(null)
  }, [block.uuid])

  // Close context menu when clicking elsewhere
  useEffect(() => {
    if (!contextMenu) return

    const handleClick = () => setContextMenu(null)
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null)
    }

    document.addEventListener('click', handleClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('click', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu])

  // Handle mousedown on block container - start drag selection
  const handleBlockMouseDown = useCallback((e: ReactMouseEvent) => {
    // Only start drag on left click, not on the contenteditable itself
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('[contenteditable]')) return

    // Start drag selection from this block
    e.preventDefault()
    startDrag(block.uuid)
    setFocusedBlock(block.uuid)
  }, [block.uuid, startDrag, setFocusedBlock])

  // Handle mouseenter during drag - extend selection
  const handleBlockMouseEnter = useCallback(() => {
    if (isDragging) {
      extendSelection(block.uuid)
    }
  }, [isDragging, block.uuid, extendSelection])

  // Handle mousedown on contenteditable
  const handleEditorMouseDown = useCallback((e: ReactMouseEvent) => {
    if (e.shiftKey) {
      // Shift+Click extends selection - don't reset anchor
      e.preventDefault()
      e.stopPropagation()

      // Get current state
      const { anchorUuid, focusedBlockUuid } = useSelectionStore.getState()

      if (!anchorUuid && !focusedBlockUuid) {
        // No anchor and no focus - can't extend, just select this block
        startSelection(block.uuid)
      } else if (!anchorUuid) {
        // No anchor but have focus - start from focused block, extend to this
        startSelection(focusedBlockUuid!)
        if (focusedBlockUuid !== block.uuid) {
          extendSelection(block.uuid)
        }
      } else {
        // Have anchor - extend to this block
        extendSelection(block.uuid)
      }
    } else {
      // Regular click - clear multi-block selection, set this as focused block
      clearSelection()
      setFocusedBlock(block.uuid)
      // Start drag in case user drags
      startDrag(block.uuid)
    }
  }, [block.uuid, setFocusedBlock, startSelection, extendSelection, clearSelection, startDrag])

  // Handle focus on contenteditable - track which block has keyboard focus
  const handleEditorFocus = useCallback(() => {
    setFocusedBlock(block.uuid)
    setIsEditorFocused(true)
  }, [block.uuid, setFocusedBlock])

  // Handle blur on contenteditable
  const handleEditorBlur = useCallback(() => {
    setIsEditorFocused(false)
  }, [])

  // Get heading level for this block
  const headingLevel = getHeadingLevel(block.content)
  const headingClass = headingLevel > 0 ? `block-heading-${headingLevel}` : ''

  // Check if block has a "completed" task status (DONE or NEVER)
  const completedKeywords = ['DONE', 'NEVER']
  const taskStatusRegex = buildTaskStatusRegex()
  const taskMatch = block.content.match(taskStatusRegex)
  const isTaskCompleted = taskMatch && completedKeywords.includes(taskMatch[1])

  return (
    <motion.div
      layout
      layoutId={block.uuid}
      transition={{
        layout: {
          type: 'spring',
          stiffness: 500,
          damping: 40,
        },
      }}
      className={`block-container ${isSelected ? 'block-container--selected' : ''} ${headingClass}`}
      data-block-id={block.uuid}
      onMouseDown={handleBlockMouseDown}
      onMouseEnter={handleBlockMouseEnter}
    >
      <div className="block flex items-start py-0.5">
        {/* Bullet point */}
        <button
          onClick={() => hasChildren && onToggleCollapse(block.uuid)}
          onContextMenu={handleBulletContextMenu}
          className={`bullet mt-[0.55rem] ${
            hasChildren ? (block.collapsed ? 'bullet--collapsed' : '') : ''
          }`}
          title={hasChildren ? (block.collapsed ? 'Expand' : 'Collapse') : undefined}
        />

        {/* Editor with smooth caret */}
        <div className="relative flex-1">
          <div
            ref={editorRef}
            contentEditable={!readonly}
            suppressContentEditableWarning
            className={`block-content outline-none min-h-[1.5em] whitespace-pre-wrap ${readonly ? 'cursor-default' : ''} ${isTaskCompleted ? 'block-content--completed' : ''}`}
            onInput={readonly ? undefined : handleInput}
            onKeyDown={readonly ? undefined : handleKeyDown}
            onMouseDown={readonly ? undefined : handleEditorMouseDown}
            onFocus={readonly ? undefined : handleEditorFocus}
            onBlur={readonly ? undefined : handleEditorBlur}
            data-placeholder={readonly ? undefined : "Type something..."}
          />
          {!readonly && <SmoothCaret containerRef={editorRef} isActive={isEditorFocused} />}
        </div>
      </div>

      {/* Children */}
      <AnimatePresence initial={false}>
        {children && !block.collapsed && (
          <motion.div
            key="children"
            layout
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="block-children ml-6 pl-3 border-l border-base-02 overflow-hidden"
            transition={{
              layout: {
                type: 'spring',
                stiffness: 500,
                damping: 40,
              },
              opacity: { duration: 0.15 },
              height: { duration: 0.2 },
            }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Wiki-link autocomplete popup */}
      {wikiLink.active && (
        <WikiLinkPopup
          query={wikiLink.query}
          position={wikiLink.position}
          onSelect={handleWikiLinkSelect}
          onClose={handleWikiLinkClose}
        />
      )}

      {/* Slash command popup */}
      {slashCommand.active && (
        <SlashCommandPopup
          query={slashCommand.query}
          position={slashCommand.position}
          onSelect={handleSlashCommandSelect}
          onClose={handleSlashCommandClose}
        />
      )}

      {/* Block context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-base-01 border border-base-02 rounded-lg shadow-lg overflow-hidden min-w-36"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            onClick={handleCopyBlockId}
            className="w-full px-3 py-2 text-left text-sm text-base-05 hover:bg-base-02 transition-colors"
          >
            Copy block ID
          </button>
        </div>
      )}
    </motion.div>
  )
}

// Helper: check if cursor is at the start of the element
function isAtStart(el: HTMLElement, selection: Selection): boolean {
  if (!selection.anchorNode) return false
  if (!selection.rangeCount) return false

  // If the element is empty
  const text = el.textContent || ''
  if (text.length === 0) return true

  // Get cursor position relative to the entire element's text
  const range = selection.getRangeAt(0)
  const preCaretRange = range.cloneRange()
  preCaretRange.selectNodeContents(el)
  preCaretRange.setEnd(range.startContainer, range.startOffset)
  const position = preCaretRange.toString().length

  return position === 0
}

// Helper: check if cursor is at the end of the element
function isAtEnd(el: HTMLElement, selection: Selection): boolean {
  if (!selection.anchorNode) return false
  if (!selection.rangeCount) return false

  // If the element is empty
  const text = el.textContent || ''
  if (text.length === 0) return true

  // Get cursor position relative to the entire element's text
  const range = selection.getRangeAt(0)
  const preCaretRange = range.cloneRange()
  preCaretRange.selectNodeContents(el)
  preCaretRange.setEnd(range.endContainer, range.endOffset)
  const position = preCaretRange.toString().length

  return position >= text.length
}

// Helper: get the cursor offset from the start of the element
function getCursorOffset(el: HTMLElement, selection: Selection): number {
  if (!selection.anchorNode || !selection.rangeCount) return 0

  const range = selection.getRangeAt(0)
  const preCaretRange = range.cloneRange()
  preCaretRange.selectNodeContents(el)
  preCaretRange.setEnd(range.startContainer, range.startOffset)
  return preCaretRange.toString().length
}

// Helper: restore cursor to a specific text offset in an element with mixed content
function restoreCursor(el: HTMLElement, offset: number): void {
  const selection = window.getSelection()
  if (!selection) return

  const range = document.createRange()
  let currentOffset = 0
  let found = false

  // Walk through all text nodes to find the right position
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let node: Text | null

  while ((node = walker.nextNode() as Text | null)) {
    const nodeLength = node.textContent?.length || 0
    if (currentOffset + nodeLength >= offset) {
      // Found the right node
      range.setStart(node, offset - currentOffset)
      range.setEnd(node, offset - currentOffset)
      found = true
      break
    }
    currentOffset += nodeLength
  }

  if (!found) {
    // Offset beyond content, put cursor at end
    range.selectNodeContents(el)
    range.collapse(false)
  }

  selection.removeAllRanges()
  selection.addRange(range)
}

// Helper: convert DOM text offset to raw content offset
// This accounts for hidden delimiters (e.g., [[ ]] around wiki-links, ** around bold)
// currentFocusedSpan tells us which span (if any) is currently showing delimiters
function domOffsetToContentOffset(
  content: string,
  domOffset: number,
  currentFocusedSpan: { start: number; end: number } | null
): number {
  // Collect all spans that have hidden delimiters
  interface HiddenSpan {
    contentStart: number
    contentEnd: number
    delimiterLength: number // Length of delimiter on each side
  }
  const hiddenSpans: HiddenSpan[] = []

  // Find wiki-links - must use same boundary-aware regex as renderContent
  // Only wiki-links followed by whitespace, punctuation, or end-of-string have hidden delimiters
  const wikiRegex = /\[\[([^\]]+)\]\](?=\s|[.,;:!?)\]}>]|$)/g
  let match
  while ((match = wikiRegex.exec(content)) !== null) {
    const start = match.index
    const end = match.index + match[0].length
    // Only hidden if not the currently focused span
    const isFocused = currentFocusedSpan && start === currentFocusedSpan.start && end === currentFocusedSpan.end
    if (!isFocused && HIDE_WIKI_LINK_BRACKETS) {
      hiddenSpans.push({ contentStart: start, contentEnd: end, delimiterLength: 2 })
    }
  }

  // Find format patterns (these already have boundary lookaheads in FORMAT_PATTERNS)
  for (const pattern of FORMAT_PATTERNS) {
    if (!pattern.hideDelimiters) continue
    const regex = new RegExp(pattern.regex.source, 'g')
    while ((match = regex.exec(content)) !== null) {
      const start = match.index
      const end = match.index + match[0].length
      // Check for overlap with wiki-links
      const overlaps = hiddenSpans.some(s =>
        (start >= s.contentStart && start < s.contentEnd) ||
        (end > s.contentStart && end <= s.contentEnd)
      )
      if (overlaps) continue
      // Only hidden if not the currently focused span
      const isFocused = currentFocusedSpan && start === currentFocusedSpan.start && end === currentFocusedSpan.end
      if (!isFocused) {
        hiddenSpans.push({ contentStart: start, contentEnd: end, delimiterLength: pattern.delimiter.length })
      }
    }
  }

  // Sort by content position
  hiddenSpans.sort((a, b) => a.contentStart - b.contentStart)

  // Walk through content, tracking how DOM offset maps to content offset
  let contentPos = 0
  let domPos = 0

  for (const span of hiddenSpans) {
    // Text before this span
    const textBeforeSpan = span.contentStart - contentPos
    if (domPos + textBeforeSpan >= domOffset) {
      // Cursor is in the text before this span
      return contentPos + (domOffset - domPos)
    }
    domPos += textBeforeSpan
    contentPos = span.contentStart

    // The span itself (delimiters hidden, so DOM shows only inner text)
    const innerTextLength = span.contentEnd - span.contentStart - (span.delimiterLength * 2)
    if (domPos + innerTextLength > domOffset) {
      // Cursor is strictly inside this span's visible text (not at the end)
      // Map to content position (after opening delimiter)
      return span.contentStart + span.delimiterLength + (domOffset - domPos)
    }
    if (domPos + innerTextLength === domOffset) {
      // Cursor is exactly at the end of the span's visible text
      // This is ambiguous: could be "end of inner text" or "after the span"
      // We treat it as AFTER the span (content position = span.contentEnd)
      // This allows cursor to escape rightward without getting trapped
      return span.contentEnd
    }
    domPos += innerTextLength
    contentPos = span.contentEnd
  }

  // Cursor is after all spans
  return contentPos + (domOffset - domPos)
}

// Helper: convert raw content offset to DOM text offset
// This is the reverse of domOffsetToContentOffset
// currentFocusedSpan tells us which span (if any) is currently showing delimiters
export function contentOffsetToDomOffset(
  content: string,
  contentOffset: number,
  currentFocusedSpan: { start: number; end: number } | null
): number {
  // Collect all spans that have hidden delimiters
  interface HiddenSpan {
    contentStart: number
    contentEnd: number
    delimiterLength: number
  }
  const hiddenSpans: HiddenSpan[] = []

  // Find wiki-links - must use same boundary-aware regex as renderContent
  // Only wiki-links followed by whitespace, punctuation, or end-of-string have hidden delimiters
  const wikiRegex = /\[\[([^\]]+)\]\](?=\s|[.,;:!?)\]}>]|$)/g
  let match
  while ((match = wikiRegex.exec(content)) !== null) {
    const start = match.index
    const end = match.index + match[0].length
    const isFocused = currentFocusedSpan && start === currentFocusedSpan.start && end === currentFocusedSpan.end
    if (!isFocused && HIDE_WIKI_LINK_BRACKETS) {
      hiddenSpans.push({ contentStart: start, contentEnd: end, delimiterLength: 2 })
    }
  }

  // Find format patterns
  for (const pattern of FORMAT_PATTERNS) {
    if (!pattern.hideDelimiters) continue
    const regex = new RegExp(pattern.regex.source, 'g')
    while ((match = regex.exec(content)) !== null) {
      const start = match.index
      const end = match.index + match[0].length
      const overlaps = hiddenSpans.some(s =>
        (start >= s.contentStart && start < s.contentEnd) ||
        (end > s.contentStart && end <= s.contentEnd)
      )
      if (overlaps) continue
      const isFocused = currentFocusedSpan && start === currentFocusedSpan.start && end === currentFocusedSpan.end
      if (!isFocused) {
        hiddenSpans.push({ contentStart: start, contentEnd: end, delimiterLength: pattern.delimiter.length })
      }
    }
  }

  hiddenSpans.sort((a, b) => a.contentStart - b.contentStart)

  // Walk through content, tracking how content offset maps to DOM offset
  let contentPos = 0
  let domPos = 0

  for (const span of hiddenSpans) {
    // Text before this span
    const textBeforeSpan = span.contentStart - contentPos
    if (contentPos + textBeforeSpan >= contentOffset) {
      // Cursor is in the text before this span
      return domPos + (contentOffset - contentPos)
    }
    domPos += textBeforeSpan
    contentPos = span.contentStart

    // Check if cursor is within the span (including delimiters, but NOT at the end)
    // Position == contentEnd means cursor is AFTER the span, not in it
    if (contentOffset < span.contentEnd) {
      // Cursor is somewhere in this span
      if (contentOffset <= span.contentStart + span.delimiterLength) {
        // Cursor is in opening delimiter - map to start of visible text
        return domPos
      } else if (contentOffset >= span.contentEnd - span.delimiterLength) {
        // Cursor is in closing delimiter - map to end of visible text
        const innerTextLength = span.contentEnd - span.contentStart - (span.delimiterLength * 2)
        return domPos + innerTextLength
      } else {
        // Cursor is in the inner text
        return domPos + (contentOffset - span.contentStart - span.delimiterLength)
      }
    }

    // Move past the span
    const innerTextLength = span.contentEnd - span.contentStart - (span.delimiterLength * 2)
    domPos += innerTextLength
    contentPos = span.contentEnd
  }

  // Cursor is after all spans
  return domPos + (contentOffset - contentPos)
}

// Helper: reconstruct raw content from DOM text when delimiters are hidden
// Takes the previous raw content (with delimiters) and the current DOM text (without delimiters)
// and figures out where text was inserted/deleted to produce new raw content
function reconstructContentFromDom(
  previousContent: string,
  domText: string
): string {
  // Find all hidden spans in the previous content
  interface HiddenSpan {
    contentStart: number
    contentEnd: number
    delimiterLength: number
    innerText: string
    fullText: string // includes delimiters
  }
  const hiddenSpans: HiddenSpan[] = []

  // Find wiki-links
  const wikiRegex = /\[\[([^\]]+)\]\](?=\s|[.,;:!?)\]}>]|$)/g
  let match
  while ((match = wikiRegex.exec(previousContent)) !== null) {
    if (HIDE_WIKI_LINK_BRACKETS) {
      hiddenSpans.push({
        contentStart: match.index,
        contentEnd: match.index + match[0].length,
        delimiterLength: 2,
        innerText: match[1],
        fullText: match[0],
      })
    }
  }

  // Find format patterns
  for (const pattern of FORMAT_PATTERNS) {
    if (!pattern.hideDelimiters) continue
    const regex = new RegExp(pattern.regex.source, 'g')
    while ((match = regex.exec(previousContent)) !== null) {
      const start = match.index
      const end = match.index + match[0].length
      const overlaps = hiddenSpans.some(s =>
        (start >= s.contentStart && start < s.contentEnd) ||
        (end > s.contentStart && end <= s.contentEnd)
      )
      if (!overlaps) {
        hiddenSpans.push({
          contentStart: start,
          contentEnd: end,
          delimiterLength: pattern.delimiter.length,
          innerText: match[1],
          fullText: match[0],
        })
      }
    }
  }

  // If no hidden spans, DOM text IS the content
  if (hiddenSpans.length === 0) {
    return domText
  }

  hiddenSpans.sort((a, b) => a.contentStart - b.contentStart)

  // Build the expected DOM text from previous content (for comparison)
  let expectedDomText = ''
  let contentPos = 0
  for (const span of hiddenSpans) {
    expectedDomText += previousContent.slice(contentPos, span.contentStart)
    expectedDomText += span.innerText
    contentPos = span.contentEnd
  }
  expectedDomText += previousContent.slice(contentPos)

  // If DOM text matches expected, no change - return previous content
  if (domText === expectedDomText) {
    return previousContent
  }

  // Special case: DOM text equals previous content exactly
  // This happens when delimiters became visible (e.g., deleted trailing space after **bold**)
  if (domText === previousContent) {
    return previousContent
  }

  // Special case: Check if DOM text is the raw content with a simple edit
  // This handles the case where hidden delimiters became visible due to boundary removal
  // In this case, we should work with raw content directly, not expected DOM text
  const domLongerThanExpected = domText.length > expectedDomText.length

  // If the DOM is showing raw delimiters (longer than expected), just use domText as content
  if (domLongerThanExpected && hiddenSpans.length > 0) {
    // The delimiters are now visible in DOM - just return the DOM text as the new content
    return domText
  }

  // Find where the change occurred by comparing domText with expectedDomText
  // Find common prefix length
  let prefixLen = 0
  while (prefixLen < domText.length && prefixLen < expectedDomText.length && domText[prefixLen] === expectedDomText[prefixLen]) {
    prefixLen++
  }

  // Find common suffix length (but not overlapping with prefix)
  let suffixLen = 0
  while (
    suffixLen < domText.length - prefixLen &&
    suffixLen < expectedDomText.length - prefixLen &&
    domText[domText.length - 1 - suffixLen] === expectedDomText[expectedDomText.length - 1 - suffixLen]
  ) {
    suffixLen++
  }

  // The change is:
  // - In expectedDomText: characters from prefixLen to (expectedDomText.length - suffixLen) were removed
  // - In domText: characters from prefixLen to (domText.length - suffixLen) were inserted
  const insertedText = domText.slice(prefixLen, domText.length - suffixLen)

  // Convert DOM prefix position to content position
  const contentPrefixPos = domOffsetToContentOffset(previousContent, prefixLen, null)
  const contentSuffixPos = domOffsetToContentOffset(previousContent, expectedDomText.length - suffixLen, null)

  // Reconstruct: content before change + inserted text + content after change
  const newContent = previousContent.slice(0, contentPrefixPos) + insertedText + previousContent.slice(contentSuffixPos)

  return newContent
}
