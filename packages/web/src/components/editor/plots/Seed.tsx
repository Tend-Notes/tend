// SPDX-License-Identifier: MIT WITH Commons-Clause
// Seed: Shell component for Plots validation
//
// This is a non-functional shell that implements the Seed interface.
// It renders static content and emits boundary events to test Plots.
// Will be replaced with real implementation that uses CodeMirror.

import { useRef, useEffect, useCallback, ReactNode, KeyboardEvent } from 'react'
import type { Block } from '../../../types'
import { useSelectionStore } from '../../../stores/selectionStore'

interface SeedProps {
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

export function Seed({
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
}: SeedProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef(block.content)

  // Selection state
  const {
    setFocusedBlock,
    startDrag,
    extendSelection,
    extendSelectionInDirection,
    clearSelection,
    isInSelection,
    hasMultiBlockSelection,
  } = useSelectionStore()
  const isDragging = useSelectionStore((state) => state.isDragging)
  const isSelected = isInSelection(block.uuid, flatBlockOrder)

  // Sync content ref
  useEffect(() => {
    contentRef.current = block.content
  }, [block.content])

  // Listen for focus events from Plots
  useEffect(() => {
    const el = editorRef.current
    if (!el) return

    const handleSeedFocus = (e: Event) => {
      const detail = (e as CustomEvent).detail
      const position = detail?.position

      // For shell, just focus the element
      el.focus()

      // Position cursor if possible
      const selection = window.getSelection()
      if (!selection) return

      const text = el.textContent || ''
      const range = document.createRange()

      if (text.length === 0) {
        range.selectNodeContents(el)
        range.collapse(true)
      } else if (position === 'start' || position === 0) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        const firstNode = walker.nextNode()
        if (firstNode) {
          range.setStart(firstNode, 0)
          range.setEnd(firstNode, 0)
        }
      } else if (position === 'end') {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        let lastNode: Node | null = null
        let node: Node | null
        while ((node = walker.nextNode())) {
          lastNode = node
        }
        if (lastNode) {
          const len = lastNode.textContent?.length || 0
          range.setStart(lastNode, len)
          range.setEnd(lastNode, len)
        }
      } else if (typeof position === 'number') {
        // Position at specific offset
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        let currentOffset = 0
        let node: Node | null
        while ((node = walker.nextNode())) {
          const nodeLen = node.textContent?.length || 0
          if (currentOffset + nodeLen >= position) {
            range.setStart(node, position - currentOffset)
            range.setEnd(node, position - currentOffset)
            break
          }
          currentOffset += nodeLen
        }
      }

      selection.removeAllRanges()
      selection.addRange(range)
    }

    el.addEventListener('seed-focus', handleSeedFocus)
    return () => el.removeEventListener('seed-focus', handleSeedFocus)
  }, [])

  // Get cursor offset
  const getCursorOffset = useCallback((el: HTMLElement, selection: Selection): number => {
    if (!selection.anchorNode || !selection.rangeCount) return 0
    const range = selection.getRangeAt(0)
    const preCaretRange = range.cloneRange()
    preCaretRange.selectNodeContents(el)
    preCaretRange.setEnd(range.startContainer, range.startOffset)
    return preCaretRange.toString().length
  }, [])

  // Check cursor position
  const isAtStart = useCallback((el: HTMLElement, selection: Selection): boolean => {
    return getCursorOffset(el, selection) === 0
  }, [getCursorOffset])

  const isAtEnd = useCallback((el: HTMLElement, selection: Selection): boolean => {
    const text = el.textContent || ''
    return getCursorOffset(el, selection) >= text.length
  }, [getCursorOffset])

  // Handle input
  const handleInput = useCallback(() => {
    const el = editorRef.current
    if (!el) return

    const newContent = el.textContent || ''
    if (newContent !== contentRef.current) {
      contentRef.current = newContent
      onChange(block.uuid, newContent)
    }
  }, [block.uuid, onChange])

  // Handle keyboard events
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const el = editorRef.current
    if (!el) return

    const selection = window.getSelection()
    if (!selection) return

    // Enter - create new block
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      clearSelection()

      const cursorOffset = getCursorOffset(el, selection)
      const content = el.textContent || ''
      const contentBefore = content.substring(0, cursorOffset)
      const contentAfter = content.substring(cursorOffset)

      // Update current block
      if (contentBefore !== block.content) {
        contentRef.current = contentBefore
        onChange(block.uuid, contentBefore)
        el.textContent = contentBefore
      }

      // Create new block with content after cursor
      const newUuid = onCreateBlock(block.uuid, contentAfter)
      if (newUuid) {
        setFocusedBlock(newUuid)
      }
      return
    }

    // Backspace at start
    if (e.key === 'Backspace') {
      if (hasMultiBlockSelection(flatBlockOrder)) return

      if (selection.isCollapsed && isAtStart(el, selection)) {
        e.preventDefault()
        onMergeWithPrevious(block.uuid)
        return
      }
    }

    // Tab / Shift-Tab
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

    // Arrow Up
    if (e.key === 'ArrowUp') {
      if (e.shiftKey && !e.altKey) {
        e.preventDefault()
        extendSelectionInDirection('up', flatBlockOrder)
        return
      }

      if (e.altKey && !e.shiftKey) {
        e.preventDefault()
        onMoveBlockUp(block.uuid)
        return
      }

      clearSelection()
      if (selection.isCollapsed && isAtStart(el, selection)) {
        e.preventDefault()
        onNavigateUp(block.uuid, getCursorOffset(el, selection))
        return
      }
    }

    // Arrow Down
    if (e.key === 'ArrowDown') {
      if (e.shiftKey && !e.altKey) {
        e.preventDefault()
        extendSelectionInDirection('down', flatBlockOrder)
        return
      }

      if (e.altKey && !e.shiftKey) {
        e.preventDefault()
        onMoveBlockDown(block.uuid)
        return
      }

      clearSelection()
      if (selection.isCollapsed && isAtEnd(el, selection)) {
        e.preventDefault()
        onNavigateDown(block.uuid, getCursorOffset(el, selection))
        return
      }
    }

    // Arrow Left at start
    if (e.key === 'ArrowLeft') {
      if (e.altKey && !e.shiftKey) {
        e.preventDefault()
        onOutdent(block.uuid)
        return
      }

      clearSelection()
      if (selection.isCollapsed && isAtStart(el, selection)) {
        e.preventDefault()
        onNavigateUp(block.uuid)
        return
      }
    }

    // Arrow Right at end
    if (e.key === 'ArrowRight') {
      if (e.altKey && !e.shiftKey) {
        e.preventDefault()
        onIndent(block.uuid)
        return
      }

      clearSelection()
      if (selection.isCollapsed && isAtEnd(el, selection)) {
        e.preventDefault()
        onNavigateDown(block.uuid)
        return
      }
    }

    // Paste
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      if (selection.isCollapsed) {
        e.preventDefault()
        onPasteBlocks(block.uuid)
        return
      }
    }
  }, [
    block.uuid,
    block.content,
    flatBlockOrder,
    onChange,
    onCreateBlock,
    onIndent,
    onOutdent,
    onMergeWithPrevious,
    onNavigateUp,
    onNavigateDown,
    onMoveBlockUp,
    onMoveBlockDown,
    onPasteBlocks,
    getCursorOffset,
    isAtStart,
    isAtEnd,
    setFocusedBlock,
    clearSelection,
    extendSelectionInDirection,
    hasMultiBlockSelection,
  ])

  // Mouse handlers for selection
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('[data-seed-editor]')) return

    e.preventDefault()
    startDrag(block.uuid)
    setFocusedBlock(block.uuid)
  }, [block.uuid, startDrag, setFocusedBlock])

  const handleMouseEnter = useCallback(() => {
    if (isDragging) {
      extendSelection(block.uuid)
    }
  }, [isDragging, block.uuid, extendSelection])

  const handleEditorMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      extendSelection(block.uuid)
    } else {
      clearSelection()
      setFocusedBlock(block.uuid)
      startDrag(block.uuid)
    }
  }, [block.uuid, setFocusedBlock, extendSelection, clearSelection, startDrag])

  const handleEditorFocus = useCallback(() => {
    setFocusedBlock(block.uuid)
  }, [block.uuid, setFocusedBlock])

  const hasChildren = block.children.length > 0

  return (
    <div
      className={`block-container ${isSelected ? 'block-container--selected' : ''}`}
      data-block-id={block.uuid}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter}
    >
      <div className="block flex items-start py-0.5">
        {/* Bullet */}
        <button
          onClick={() => hasChildren && onToggleCollapse(block.uuid)}
          className={`bullet mt-[0.55rem] ${
            hasChildren ? (block.collapsed ? 'bullet--collapsed' : '') : ''
          }`}
          title={hasChildren ? (block.collapsed ? 'Expand' : 'Collapse') : undefined}
        />

        {/* Editor */}
        <div className="relative flex-1">
          <div
            ref={editorRef}
            data-seed-editor
            contentEditable={!readonly}
            suppressContentEditableWarning
            className={`block-content outline-none min-h-[1.5em] whitespace-pre-wrap ${readonly ? 'cursor-default' : ''}`}
            onInput={readonly ? undefined : handleInput}
            onKeyDown={readonly ? undefined : handleKeyDown}
            onMouseDown={readonly ? undefined : handleEditorMouseDown}
            onFocus={readonly ? undefined : handleEditorFocus}
            data-placeholder={readonly ? undefined : 'Type something...'}
          >
            {block.content}
          </div>
        </div>
      </div>

      {/* Children */}
      {children && !block.collapsed && (
        <div className="block-children ml-6 pl-3 border-l border-base-02">
          {children}
        </div>
      )}
    </div>
  )
}
