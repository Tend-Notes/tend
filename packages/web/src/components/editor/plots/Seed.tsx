// SPDX-License-Identifier: MIT WITH Commons-Clause
// Seed: Block content component
//
// Handles text editing within a single block. Uses contenteditable for now,
// will be replaced with CodeMirror when Actions layer is implemented.
//
// Seed is responsible for:
// - Text input and editing
// - Cursor position tracking
// - Detecting boundary events (cursor at start/end) and delegating to Plots
// - Rendering content (plain text now, formatted text via Actions later)

import { useRef, useEffect, useCallback, KeyboardEvent, FormEvent } from 'react'
import type { Block } from '../../../types'

// Placeholder for Actions layer - will handle formatting, decorations, etc.
export interface SeedActions {
  renderContent: (content: string) => string
  applyFormat: (format: string, selection: { start: number; end: number }) => string
}

interface SeedProps {
  block: Block
  isSelected: boolean
  onChange: (content: string) => void
  onBoundaryEvent: (event: SeedBoundaryEvent) => void
  readonly?: boolean
}

// Events that Seed reports to Plots for tree-level handling
export type SeedBoundaryEvent =
  | { type: 'enter'; cursorOffset: number; content: string }
  | { type: 'backspace-at-start' }
  | { type: 'delete-at-end' }
  | { type: 'arrow-up'; cursorOffset: number }
  | { type: 'arrow-down'; cursorOffset: number }
  | { type: 'arrow-left-at-start' }
  | { type: 'arrow-right-at-end' }
  | { type: 'tab' }
  | { type: 'shift-tab' }
  | { type: 'alt-arrow-up' }
  | { type: 'alt-arrow-down' }
  | { type: 'shift-arrow-up' }
  | { type: 'shift-arrow-down' }

export function Seed({
  block,
  isSelected,
  onChange,
  onBoundaryEvent,
  readonly = false,
}: SeedProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef(block.content)

  // Sync content ref when block changes externally
  useEffect(() => {
    contentRef.current = block.content
    const el = editorRef.current
    if (el && el.textContent !== block.content) {
      el.textContent = block.content
    }
  }, [block.content])

  // Focus when selected
  useEffect(() => {
    if (isSelected && editorRef.current) {
      editorRef.current.focus()
    }
  }, [isSelected])

  // ─────────────────────────────────────────────────────────────────────────
  // CURSOR HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  const getCursorOffset = useCallback((el: HTMLElement, selection: Selection): number => {
    if (!selection.anchorNode || !selection.rangeCount) return 0
    const range = selection.getRangeAt(0)
    const preCaretRange = range.cloneRange()
    preCaretRange.selectNodeContents(el)
    preCaretRange.setEnd(range.startContainer, range.startOffset)
    return preCaretRange.toString().length
  }, [])

  const isAtStart = useCallback((el: HTMLElement, selection: Selection): boolean => {
    return getCursorOffset(el, selection) === 0
  }, [getCursorOffset])

  const isAtEnd = useCallback((el: HTMLElement, selection: Selection): boolean => {
    const text = el.textContent || ''
    return getCursorOffset(el, selection) >= text.length
  }, [getCursorOffset])

  const setCursorPosition = useCallback((el: HTMLElement, offset: number) => {
    const selection = window.getSelection()
    if (!selection) return

    const range = document.createRange()
    const text = el.textContent || ''
    const targetOffset = Math.min(offset, text.length)

    // Walk text nodes to find position
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let currentOffset = 0
    let node: Node | null = walker.nextNode()

    while (node) {
      const nodeLength = node.textContent?.length || 0
      if (currentOffset + nodeLength >= targetOffset) {
        range.setStart(node, targetOffset - currentOffset)
        range.setEnd(node, targetOffset - currentOffset)
        selection.removeAllRanges()
        selection.addRange(range)
        return
      }
      currentOffset += nodeLength
      node = walker.nextNode()
    }

    // Fallback: put cursor at end
    range.selectNodeContents(el)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  }, [])

  // ─────────────────────────────────────────────────────────────────────────
  // INPUT HANDLER
  // ─────────────────────────────────────────────────────────────────────────

  const handleInput = useCallback((e: FormEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const newContent = el.textContent || ''

    if (newContent !== contentRef.current) {
      contentRef.current = newContent
      onChange(newContent)
    }
  }, [onChange])

  // ─────────────────────────────────────────────────────────────────────────
  // KEYBOARD HANDLER
  // ─────────────────────────────────────────────────────────────────────────

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const el = editorRef.current
    if (!el) return

    const selection = window.getSelection()
    if (!selection) return

    // Enter - split block
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const cursorOffset = getCursorOffset(el, selection)
      const content = el.textContent || ''
      onBoundaryEvent({
        type: 'enter',
        cursorOffset,
        content,
      })
      return
    }

    // Shift+Enter - allow line break (default behavior)
    if (e.key === 'Enter' && e.shiftKey) {
      // Let browser insert line break
      return
    }

    // Tab - indent/outdent
    if (e.key === 'Tab') {
      e.preventDefault()
      if (e.shiftKey) {
        onBoundaryEvent({ type: 'shift-tab' })
      } else {
        onBoundaryEvent({ type: 'tab' })
      }
      return
    }

    // Alt+Arrow - move block
    if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault()
      onBoundaryEvent({ type: 'alt-arrow-up' })
      return
    }
    if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault()
      onBoundaryEvent({ type: 'alt-arrow-down' })
      return
    }

    // Backspace at start
    if (e.key === 'Backspace' && selection.isCollapsed && isAtStart(el, selection)) {
      e.preventDefault()
      onBoundaryEvent({ type: 'backspace-at-start' })
      return
    }

    // Delete at end
    if (e.key === 'Delete' && selection.isCollapsed && isAtEnd(el, selection)) {
      e.preventDefault()
      onBoundaryEvent({ type: 'delete-at-end' })
      return
    }

    // Shift+Arrow Up - extend selection upward
    if (e.key === 'ArrowUp' && e.shiftKey && !e.altKey) {
      e.preventDefault()
      onBoundaryEvent({ type: 'shift-arrow-up' })
      return
    }

    // Shift+Arrow Down - extend selection downward
    if (e.key === 'ArrowDown' && e.shiftKey && !e.altKey) {
      e.preventDefault()
      onBoundaryEvent({ type: 'shift-arrow-down' })
      return
    }

    // Arrow Up - navigate if at start or single line
    if (e.key === 'ArrowUp' && !e.altKey && !e.shiftKey) {
      if (selection.isCollapsed) {
        const hasLineBreaks = (el.textContent || '').includes('\n')
        if (!hasLineBreaks || isAtStart(el, selection)) {
          e.preventDefault()
          onBoundaryEvent({
            type: 'arrow-up',
            cursorOffset: getCursorOffset(el, selection),
          })
          return
        }
      }
    }

    // Arrow Down - navigate if at end or single line
    if (e.key === 'ArrowDown' && !e.altKey && !e.shiftKey) {
      if (selection.isCollapsed) {
        const hasLineBreaks = (el.textContent || '').includes('\n')
        if (!hasLineBreaks || isAtEnd(el, selection)) {
          e.preventDefault()
          onBoundaryEvent({
            type: 'arrow-down',
            cursorOffset: getCursorOffset(el, selection),
          })
          return
        }
      }
    }

    // Arrow Left at start
    if (e.key === 'ArrowLeft' && !e.altKey && !e.shiftKey) {
      if (selection.isCollapsed && isAtStart(el, selection)) {
        e.preventDefault()
        onBoundaryEvent({ type: 'arrow-left-at-start' })
        return
      }
    }

    // Arrow Right at end
    if (e.key === 'ArrowRight' && !e.altKey && !e.shiftKey) {
      if (selection.isCollapsed && isAtEnd(el, selection)) {
        e.preventDefault()
        onBoundaryEvent({ type: 'arrow-right-at-end' })
        return
      }
    }
  }, [getCursorOffset, isAtStart, isAtEnd, onBoundaryEvent])

  // ─────────────────────────────────────────────────────────────────────────
  // FOCUS EVENT - expose cursor positioning to Plots
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const el = editorRef.current
    if (!el) return

    const handleSeedFocus = (e: Event) => {
      const detail = (e as CustomEvent).detail
      const position = detail?.position

      el.focus()

      if (position === 'start') {
        setCursorPosition(el, 0)
      } else if (position === 'end') {
        setCursorPosition(el, (el.textContent || '').length)
      } else if (typeof position === 'number') {
        setCursorPosition(el, position)
      }
    }

    el.addEventListener('seed-focus', handleSeedFocus)
    return () => el.removeEventListener('seed-focus', handleSeedFocus)
  }, [setCursorPosition])

  // ─────────────────────────────────────────────────────────────────────────
  // INITIALIZE CONTENT
  // ─────────────────────────────────────────────────────────────────────────

  // Set initial content on mount (contenteditable manages its own DOM)
  useEffect(() => {
    const el = editorRef.current
    if (el) {
      el.textContent = block.content
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div
      ref={editorRef}
      data-seed-editor
      contentEditable={!readonly}
      suppressContentEditableWarning
      className={`block-content outline-none min-h-[1.5em] whitespace-pre-wrap ${
        readonly ? 'cursor-default' : ''
      }`}
      onInput={readonly ? undefined : handleInput}
      onKeyDown={readonly ? undefined : handleKeyDown}
      style={{ caretColor: 'var(--base05, currentColor)' }}
    />
  )
}
