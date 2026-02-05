// SPDX-License-Identifier: MIT WITH Commons-Clause
// Plots: Outline container component
//
// Manages the block tree structure. Owns selection state and keyboard navigation.
// Drop-in replacement for OutlinerEditor - same props interface.
//
// Seeds handle text editing and report boundary events back to Plots.
// Code fence detection scans blocks to identify ``` regions for visual treatment.

import { useMemo, useEffect, useCallback, useState, useRef } from 'react'
import type { Page, Block } from '../../../types'
import { usePageStore } from '../../../stores/pageStore'
import { useSelectionStore } from '../../../stores/selectionStore'
import { useUIStore } from '../../../stores/uiStore'
import { useToastStore } from '../../../stores/toastStore'
import { Seed, SeedBoundaryEvent } from './Seed'
import { parseContent, mapRenderedOffsetToSource } from '../contentRenderer'
import { useBlockFlip } from './useBlockFlip'
import { useGardenInfo } from '../../../hooks/useGardenInfo'
import { BlockContextMenu } from '../../ui/BlockContextMenu'
import { TaskMetadata } from '../TaskMetadata'
import { v4 as uuidv4 } from 'uuid'

// Regex to detect task blocks (TODO, DOING, DONE, NOW, LATER, NEVER)
const TASK_STATUS_REGEX = /^(TODO|DOING|DONE|NOW|LATER|NEVER)(\s|$)/

interface PlotsProps {
  page: Page
  readonly?: boolean
  /** Optional callback for block changes. If provided, used instead of updateCurrentPage. */
  onBlocksChange?: (blocks: Block[], rootBlocksHint?: string[]) => void
}

// Code block metadata for blocks within a fenced code region
interface CodeBlockInfo {
  isCodeBlock: true
  isStart: boolean   // Has opening ```
  isEnd: boolean     // Has closing ```
  language: string   // Language from opening fence (e.g., "js", "rust")
}

// Detect code fence regions by scanning block content in document order
// Returns a map of block UUID to code block metadata
// Supports two modes:
// 1. Single-block: ``` at start, ``` at end, code in between (all in one block)
// 2. Multi-block: Opening ``` on its own block, content blocks, closing ``` on its own block
function detectCodeFences(flatOrder: string[], blocks: Record<string, Block>): Map<string, CodeBlockInfo> {
  const result = new Map<string, CodeBlockInfo>()
  let inCodeBlock = false
  let currentLanguage = ''
  let startUuid: string | null = null
  const pendingBlocks: string[] = []

  for (const uuid of flatOrder) {
    const block = blocks[uuid]
    if (!block) continue

    const content = block.content.trim()

    // Check for single-block code fence: starts with ```, ends with ```
    // Pattern: ```lang followed by content and closing ```
    // Handles: ```js\ncode\n``` or ```js\ncode```  (with or without trailing newline)
    const singleBlockMatch = content.match(/^```([\w+#-]*)[\r\n]+([\s\S]*?)[\r\n]*```$/)
    if (singleBlockMatch) {
      result.set(uuid, {
        isCodeBlock: true,
        isStart: true,
        isEnd: true,
        language: singleBlockMatch[1] || '',
      })
      continue
    }

    // Multi-block detection: opening fence on its own line/block
    // Match opening fence: ``` optionally followed by language identifier
    // Language can include letters, numbers, hyphens, plus signs (e.g., c++, vue-template)
    const openMatch = content.match(/^```([\w+#-]*)$/)
    const closeMatch = content === '```'

    if (!inCodeBlock && openMatch) {
      // Starting a new code block
      inCodeBlock = true
      currentLanguage = openMatch[1] || ''
      startUuid = uuid
      pendingBlocks.length = 0
      pendingBlocks.push(uuid)
    } else if (inCodeBlock && closeMatch) {
      // Closing the code block
      pendingBlocks.push(uuid)

      // Mark all pending blocks
      for (let i = 0; i < pendingBlocks.length; i++) {
        const pendingUuid = pendingBlocks[i]
        result.set(pendingUuid, {
          isCodeBlock: true,
          isStart: pendingUuid === startUuid,
          isEnd: pendingUuid === uuid,
          language: currentLanguage,
        })
      }

      inCodeBlock = false
      currentLanguage = ''
      startUuid = null
      pendingBlocks.length = 0
    } else if (inCodeBlock) {
      // Inside code block
      pendingBlocks.push(uuid)
    }
  }

  // If we ended while still in a code block, don't mark any blocks
  // (incomplete fence should render normally)

  return result
}

export function Plots({ page, readonly = false, onBlocksChange }: PlotsProps) {
  const updateCurrentPageFromStore = usePageStore((state) => state.updateCurrentPage)
  const consumePendingCursorPosition = usePageStore((state) => state.consumePendingCursorPosition)
  const consumePendingScrollTarget = usePageStore((state) => state.consumePendingScrollTarget)

  // Use onBlocksChange if provided (for template editing), otherwise use store's updateCurrentPage
  const updateCurrentPage = onBlocksChange ?? updateCurrentPageFromStore
  const {
    setFocusedBlock,
    extendSelectionInDirection,
    clearSelection,
    isInSelection,
  } = useSelectionStore()
  // Subscribe to selection state changes to trigger re-renders
  const anchorUuid = useSelectionStore((state) => state.anchorUuid)
  const focusUuid = useSelectionStore((state) => state.focusUuid)
  // Force re-render when selection changes (these aren't used directly but trigger updates)
  void anchorUuid
  void focusUuid
  const containerRef = useRef<HTMLDivElement>(null)
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; uuid: string } | null>(null)
  const pendingFocusRef = useRef<{ uuid: string; position: 'start' | 'end' | number } | null>(null)

  // Click-to-edit: track which seed is active (has CodeMirror). Null = all dormant.
  const [activeBlockUuid, setActiveBlockUuid] = useState<string | null>(null)
  // Store cursor offset between activation request and next render
  const pendingCursorPositionRef = useRef<number | undefined>(undefined)
  // Track last-active block UUID for keyboard re-activation when all seeds are dormant
  const lastActiveBlockUuidRef = useRef<string | null>(null)

  // Garden info for encrypted garden checks
  const { isEncrypted } = useGardenInfo()
  const addToast = useToastStore((state) => state.addToast)

  // FLIP animation for block movements
  const { capturePositions } = useBlockFlip(containerRef)

  // Get root blocks for rendering
  const rootBlocks = useMemo(() => {
    return page.rootBlocks
      .map((uuid) => page.blocks[uuid])
      .filter(Boolean)
  }, [page.rootBlocks, page.blocks])

  // Flattened block order for navigation
  const flatBlockOrder = useMemo(() => {
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
  }, [page.blocks, page.rootBlocks])

  // Detect code fence regions for visual treatment
  const codeFenceMap = useMemo(() => {
    return detectCodeFences(flatBlockOrder, page.blocks)
  }, [flatBlockOrder, page.blocks])

  // Get fresh flat block order directly from store (not memoized, for selection)
  // This is needed because the memoized flatBlockOrder may be stale after state updates
  const getFreshFlatBlockOrder = useCallback((): string[] => {
    const currentPage = usePageStore.getState().currentPage
    if (!currentPage) return []
    const result: string[] = []
    const traverse = (uuids: string[]) => {
      for (const uuid of uuids) {
        const block = currentPage.blocks[uuid]
        if (block) {
          result.push(uuid)
          if (!block.collapsed && block.children.length > 0) {
            traverse(block.children)
          }
        }
      }
    }
    traverse(currentPage.rootBlocks)
    return result
  }, [])

  // Convert blocks object to array for saving (deterministic tree order)
  const getAllBlocks = useCallback((): Block[] => {
    const result: Block[] = []
    const traverse = (uuid: string) => {
      const block = page.blocks[uuid]
      if (block) {
        result.push(block)
        block.children.forEach(traverse)
      }
    }
    page.rootBlocks.forEach(traverse)
    return result
  }, [page.blocks, page.rootBlocks])

  // Focus a block's Seed at a specific position
  const setLastFocusedBlockUuid = useUIStore((state) => state.setLastFocusedBlockUuid)
  const focusBlock = useCallback((uuid: string, position: 'start' | 'end' | number) => {
    setSelectedUuid(uuid)
    setFocusedBlock(uuid)
    setLastFocusedBlockUuid(uuid) // Update synchronously for command palette text insertion
    clearSelection()

    // Activate the target seed (transitions from dormant to active)
    setActiveBlockUuid(uuid)

    // Store cursor position for the seed's initialCursorPosition prop.
    // If the seed is already active, pendingFocusRef handles cursor placement
    // via the seed-focus custom event. If transitioning from dormant, the
    // initialCursorPosition prop picks it up on mount.
    if (typeof position === 'number') {
      pendingCursorPositionRef.current = position
    } else if (position === 'start') {
      pendingCursorPositionRef.current = 0
    } else {
      // 'end' - we don't know the length here; use a sentinel.
      // The seed-focus event handles 'end' for already-active seeds.
      // For dormant->active, Seed's initialCursorPosition with Infinity
      // will be clamped to doc.length in ActiveSeed.
      pendingCursorPositionRef.current = Infinity
    }

    pendingFocusRef.current = { uuid, position }
  }, [setFocusedBlock, setLastFocusedBlockUuid, clearSelection])

  // Apply pending focus after render
  // Track the current focus target to cancel stale polls
  const currentFocusTargetRef = useRef<string | null>(null)

  useEffect(() => {
    // Clear the pending cursor position after render - the seed has consumed it
    // via initialCursorPosition prop during this render cycle
    pendingCursorPositionRef.current = undefined

    if (pendingFocusRef.current) {
      const { uuid, position } = pendingFocusRef.current
      pendingFocusRef.current = null

      // Set current target - any previous poll will see this changed and stop
      currentFocusTargetRef.current = uuid

      // Poll for the block element to appear in the DOM
      // This handles rapid block creation where React hasn't rendered yet
      let attempts = 0
      const maxAttempts = 10 // Give up after ~100ms

      const tryFocus = () => {
        // Cancel if a newer focus was requested
        if (currentFocusTargetRef.current !== uuid) {
          return
        }

        const blockEl = document.querySelector(`[data-block-id="${uuid}"]`)
        const editorEl = blockEl?.querySelector('[data-seed-editor]') as HTMLElement

        if (editorEl) {
          const event = new CustomEvent('seed-focus', {
            detail: { position },
            bubbles: false,
          })
          editorEl.dispatchEvent(event)
        } else if (attempts < maxAttempts) {
          attempts++
          requestAnimationFrame(tryFocus)
        }
      }

      requestAnimationFrame(tryFocus)
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // TREE OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────

  const handleToggleCollapse = useCallback(
    (uuid: string) => {
      const blocks = getAllBlocks().map((b) =>
        b.uuid === uuid ? { ...b, collapsed: !b.collapsed } : b
      )
      updateCurrentPage(blocks)
    },
    [getAllBlocks, updateCurrentPage]
  )

  const handleBlockChange = useCallback(
    (uuid: string, content: string) => {
      const blocks = getAllBlocks().map((b) =>
        b.uuid === uuid ? { ...b, content } : b
      )
      updateCurrentPage(blocks)
    },
    [getAllBlocks, updateCurrentPage]
  )

  const handleBlockPropertyChange = useCallback(
    (uuid: string, key: string, value: string | null) => {
      const blocks = getAllBlocks().map((b) => {
        if (b.uuid !== uuid) return b
        const newProperties = { ...b.properties }
        if (value === null) {
          delete newProperties[key]
        } else {
          newProperties[key] = value
        }
        return { ...b, properties: newProperties }
      })
      updateCurrentPage(blocks)
    },
    [getAllBlocks, updateCurrentPage]
  )

  // Split a block at a cursor position: truncate current block and create a new
  // block with the remainder. Both mutations happen in a single updateCurrentPage
  // call so there is no stale-state race between the truncation and the insertion.
  const handleSplitBlock = useCallback(
    (uuid: string, contentBefore: string, contentAfter: string): string => {
      const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
      const afterBlock = blocks.find((b) => b.uuid === uuid)
      if (!afterBlock) return uuid

      // Truncate the current block
      afterBlock.content = contentBefore

      const hasVisibleChildren = afterBlock.children.length > 0 && !afterBlock.collapsed

      const newBlock: Block = {
        uuid: uuidv4(),
        content: contentAfter,
        parentUuid: hasVisibleChildren ? uuid : afterBlock.parentUuid,
        children: [],
        collapsed: false,
        properties: {},
        depth: hasVisibleChildren ? afterBlock.depth + 1 : afterBlock.depth,
      }

      if (hasVisibleChildren) {
        afterBlock.children = [newBlock.uuid, ...afterBlock.children]
        updateCurrentPage([...blocks, newBlock])
      } else if (afterBlock.parentUuid) {
        const parent = blocks.find((b) => b.uuid === afterBlock.parentUuid)
        if (parent) {
          const afterIndex = parent.children.indexOf(uuid)
          parent.children = [
            ...parent.children.slice(0, afterIndex + 1),
            newBlock.uuid,
            ...parent.children.slice(afterIndex + 1),
          ]
        }
        updateCurrentPage([...blocks, newBlock])
      } else {
        const afterIndex = page.rootBlocks.indexOf(uuid)
        const newRootBlocks = [
          ...page.rootBlocks.slice(0, afterIndex + 1),
          newBlock.uuid,
          ...page.rootBlocks.slice(afterIndex + 1),
        ]
        updateCurrentPage([...blocks, newBlock], newRootBlocks)
      }

      return newBlock.uuid
    },
    [getAllBlocks, updateCurrentPage, page.rootBlocks]
  )

  const handleCreateBlockBefore = useCallback(
    (beforeUuid: string): string => {
      const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
      const beforeBlock = blocks.find((b) => b.uuid === beforeUuid)
      if (!beforeBlock) return beforeUuid

      // New block goes at same level, BEFORE the current block
      const newBlock: Block = {
        uuid: uuidv4(),
        content: '',
        parentUuid: beforeBlock.parentUuid,
        children: [],
        collapsed: false,
        properties: {},
        depth: beforeBlock.depth,
      }

      if (beforeBlock.parentUuid) {
        const parent = blocks.find((b) => b.uuid === beforeBlock.parentUuid)
        if (parent) {
          const beforeIndex = parent.children.indexOf(beforeUuid)
          parent.children = [
            ...parent.children.slice(0, beforeIndex),
            newBlock.uuid,
            ...parent.children.slice(beforeIndex),
          ]
        }
        updateCurrentPage([...blocks, newBlock])
      } else {
        // Root level - insert before in rootBlocks
        const beforeIndex = page.rootBlocks.indexOf(beforeUuid)
        const newRootBlocks = [
          ...page.rootBlocks.slice(0, beforeIndex),
          newBlock.uuid,
          ...page.rootBlocks.slice(beforeIndex),
        ]
        updateCurrentPage([...blocks, newBlock], newRootBlocks)
      }

      return newBlock.uuid
    },
    [getAllBlocks, updateCurrentPage, page.rootBlocks]
  )

  const handleMergeWithPrevious = useCallback(
    (uuid: string) => {
      const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
      const currentIndex = flatBlockOrder.indexOf(uuid)
      if (currentIndex <= 0) return

      const currentBlock = blocks.find((b) => b.uuid === uuid)
      const previousUuid = flatBlockOrder[currentIndex - 1]
      const previousBlock = blocks.find((b) => b.uuid === previousUuid)

      if (!currentBlock || !previousBlock) return

      const cursorPos = previousBlock.content.length

      // Append content
      previousBlock.content = previousBlock.content + currentBlock.content

      // Remove from parent
      if (currentBlock.parentUuid) {
        const parent = blocks.find((b) => b.uuid === currentBlock.parentUuid)
        if (parent) {
          parent.children = parent.children.filter((id) => id !== uuid)
        }
      }

      // Transfer children
      if (currentBlock.children.length > 0) {
        for (const childUuid of currentBlock.children) {
          const child = blocks.find((b) => b.uuid === childUuid)
          if (child) {
            child.parentUuid = previousUuid
          }
        }
        previousBlock.children = [...previousBlock.children, ...currentBlock.children]
      }

      const updatedBlocks = blocks.filter((b) => b.uuid !== uuid)
      // Pass rootBlocks hint with the deleted block removed
      const newRootBlocks = page.rootBlocks.filter((id) => id !== uuid)
      updateCurrentPage(updatedBlocks, newRootBlocks)

      focusBlock(previousUuid, cursorPos)
    },
    [getAllBlocks, flatBlockOrder, updateCurrentPage, focusBlock, page.rootBlocks]
  )

  const handleMergeWithNext = useCallback(
    (uuid: string) => {
      const currentIndex = flatBlockOrder.indexOf(uuid)
      if (currentIndex >= flatBlockOrder.length - 1) return

      const nextUuid = flatBlockOrder[currentIndex + 1]
      // Merge next into current (delete at end = merge next into this)
      const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
      const currentBlock = blocks.find((b) => b.uuid === uuid)
      const nextBlock = blocks.find((b) => b.uuid === nextUuid)

      if (!currentBlock || !nextBlock) return

      const cursorPos = currentBlock.content.length

      // Append content
      currentBlock.content = currentBlock.content + nextBlock.content

      // Remove next from parent
      if (nextBlock.parentUuid) {
        const parent = blocks.find((b) => b.uuid === nextBlock.parentUuid)
        if (parent) {
          parent.children = parent.children.filter((id) => id !== nextUuid)
        }
      }

      // Transfer next's children to current
      if (nextBlock.children.length > 0) {
        for (const childUuid of nextBlock.children) {
          const child = blocks.find((b) => b.uuid === childUuid)
          if (child) {
            child.parentUuid = uuid
          }
        }
        currentBlock.children = [...currentBlock.children, ...nextBlock.children]
      }

      const updatedBlocks = blocks.filter((b) => b.uuid !== nextUuid)
      // Pass rootBlocks hint with the deleted block removed
      const newRootBlocks = page.rootBlocks.filter((id) => id !== nextUuid)
      updateCurrentPage(updatedBlocks, newRootBlocks)

      focusBlock(uuid, cursorPos)
    },
    [getAllBlocks, flatBlockOrder, updateCurrentPage, focusBlock, page.rootBlocks]
  )

  const handleIndent = useCallback(
    (uuid: string) => {
      // Capture positions before the move for FLIP animation
      capturePositions()

      const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
      const block = blocks.find((b) => b.uuid === uuid)
      if (!block) return

      const siblings = block.parentUuid
        ? blocks.find((b) => b.uuid === block.parentUuid)?.children || []
        : page.rootBlocks

      const currentIndex = siblings.indexOf(uuid)
      if (currentIndex <= 0) return

      const newParentUuid = siblings[currentIndex - 1]
      const newParent = blocks.find((b) => b.uuid === newParentUuid)
      if (!newParent) return

      // Remove from current parent
      if (block.parentUuid) {
        const oldParent = blocks.find((b) => b.uuid === block.parentUuid)
        if (oldParent) {
          oldParent.children = oldParent.children.filter((id) => id !== uuid)
        }
      }

      // Track if we need to remove from rootBlocks
      const wasRoot = !blocks.find((b) => b.uuid === uuid)?.parentUuid

      // Add to new parent
      newParent.children = [...newParent.children, uuid]
      block.parentUuid = newParentUuid
      block.depth += 1

      // Update children depths
      const updateChildDepths = (parentId: string, parentDepth: number) => {
        const p = blocks.find((b) => b.uuid === parentId)
        if (!p) return
        for (const childUuid of p.children) {
          const child = blocks.find((b) => b.uuid === childUuid)
          if (child) {
            child.depth = parentDepth + 1
            updateChildDepths(childUuid, child.depth)
          }
        }
      }
      updateChildDepths(uuid, block.depth)

      // Pass rootBlocks hint - block is no longer a root after indent
      const newRootBlocks = wasRoot ? page.rootBlocks.filter((id) => id !== uuid) : page.rootBlocks
      updateCurrentPage(blocks, newRootBlocks)
    },
    [getAllBlocks, page.rootBlocks, updateCurrentPage, capturePositions]
  )

  const handleOutdent = useCallback(
    (uuid: string) => {
      // Capture positions before the move for FLIP animation
      capturePositions()

      const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
      const block = blocks.find((b) => b.uuid === uuid)
      if (!block || !block.parentUuid) return

      const parent = blocks.find((b) => b.uuid === block.parentUuid)
      if (!parent) return

      // Remove from parent
      parent.children = parent.children.filter((id) => id !== uuid)

      const newParentUuid = parent.parentUuid
      block.parentUuid = newParentUuid
      block.depth = Math.max(0, block.depth - 1)

      // Compute new rootBlocks if becoming a root
      let newRootBlocks = page.rootBlocks

      // Insert after parent
      if (newParentUuid) {
        const grandparent = blocks.find((b) => b.uuid === newParentUuid)
        if (grandparent) {
          const parentIndex = grandparent.children.indexOf(parent.uuid)
          grandparent.children = [
            ...grandparent.children.slice(0, parentIndex + 1),
            uuid,
            ...grandparent.children.slice(parentIndex + 1),
          ]
        }
      } else {
        // Block is becoming a root - insert after parent in rootBlocks
        const parentIndex = page.rootBlocks.indexOf(parent.uuid)
        newRootBlocks = [
          ...page.rootBlocks.slice(0, parentIndex + 1),
          uuid,
          ...page.rootBlocks.slice(parentIndex + 1),
        ]
      }

      // Update children depths
      const updateChildDepths = (parentId: string, parentDepth: number) => {
        const p = blocks.find((b) => b.uuid === parentId)
        if (!p) return
        for (const childUuid of p.children) {
          const child = blocks.find((b) => b.uuid === childUuid)
          if (child) {
            child.depth = parentDepth + 1
            updateChildDepths(childUuid, child.depth)
          }
        }
      }
      updateChildDepths(uuid, block.depth)

      updateCurrentPage(blocks, newRootBlocks)
    },
    [getAllBlocks, updateCurrentPage, page.rootBlocks, capturePositions]
  )

  const handleMoveUp = useCallback(
    (uuid: string) => {
      // Capture positions before the move for FLIP animation
      capturePositions()

      const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
      const block = blocks.find((b) => b.uuid === uuid)
      if (!block) return

      const siblings = block.parentUuid
        ? blocks.find((b) => b.uuid === block.parentUuid)?.children || []
        : [...page.rootBlocks]

      const currentIndex = siblings.indexOf(uuid)

      if (currentIndex > 0) {
        // Swap positions with previous sibling
        ;[siblings[currentIndex - 1], siblings[currentIndex]] =
          [siblings[currentIndex], siblings[currentIndex - 1]]

        if (block.parentUuid) {
          const parent = blocks.find((b) => b.uuid === block.parentUuid)
          if (parent) {
            parent.children = siblings
          }
          updateCurrentPage(blocks)
        } else {
          // Root blocks - pass the reordered siblings as the rootBlocks hint
          updateCurrentPage(blocks, siblings)
        }
      } else if (block.parentUuid) {
        // At top of siblings - outdent (move before parent)
        handleOutdent(uuid)
      }
    },
    [getAllBlocks, page.rootBlocks, handleOutdent, capturePositions, updateCurrentPage]
  )

  const handleMoveDown = useCallback(
    (uuid: string) => {
      // Capture positions before the move for FLIP animation
      capturePositions()

      const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
      const block = blocks.find((b) => b.uuid === uuid)
      if (!block) return

      const siblings = block.parentUuid
        ? blocks.find((b) => b.uuid === block.parentUuid)?.children || []
        : [...page.rootBlocks]

      const currentIndex = siblings.indexOf(uuid)

      if (currentIndex < siblings.length - 1) {
        // Swap positions with next sibling
        ;[siblings[currentIndex], siblings[currentIndex + 1]] =
          [siblings[currentIndex + 1], siblings[currentIndex]]

        if (block.parentUuid) {
          const parent = blocks.find((b) => b.uuid === block.parentUuid)
          if (parent) {
            parent.children = siblings
          }
          updateCurrentPage(blocks)
        } else {
          // Root blocks - pass the reordered siblings as the rootBlocks hint
          updateCurrentPage(blocks, siblings)
        }
      } else if (block.parentUuid) {
        // At bottom of siblings - outdent (move after parent)
        handleOutdent(uuid)
      }
    },
    [getAllBlocks, page.rootBlocks, handleOutdent, capturePositions, updateCurrentPage]
  )

  // ─────────────────────────────────────────────────────────────────────────
  // NAVIGATION
  // ─────────────────────────────────────────────────────────────────────────

  const navigateUp = useCallback((fromUuid: string, cursorOffset?: number) => {
    const currentIndex = flatBlockOrder.indexOf(fromUuid)
    if (currentIndex > 0) {
      const prevUuid = flatBlockOrder[currentIndex - 1]
      focusBlock(prevUuid, cursorOffset !== undefined ? cursorOffset : 'end')
    }
  }, [flatBlockOrder, focusBlock])

  const navigateDown = useCallback((fromUuid: string, cursorOffset?: number) => {
    const currentIndex = flatBlockOrder.indexOf(fromUuid)
    if (currentIndex < flatBlockOrder.length - 1) {
      const nextUuid = flatBlockOrder[currentIndex + 1]
      focusBlock(nextUuid, cursorOffset !== undefined ? cursorOffset : 'start')
    }
  }, [flatBlockOrder, focusBlock])

  // ─────────────────────────────────────────────────────────────────────────
  // BLOCK REFERENCE COPY
  // ─────────────────────────────────────────────────────────────────────────

  const copyBlockReference = useCallback(async (uuid: string) => {
    // Block references are disabled for encrypted gardens
    if (isEncrypted) {
      addToast('Block references disabled for encrypted gardens')
      return
    }

    const reference = `((${uuid}))`
    try {
      await navigator.clipboard.writeText(reference)
      addToast('Block reference copied')
    } catch (err) {
      console.error('Failed to copy block reference:', err)
      addToast('Failed to copy')
    }
  }, [isEncrypted, addToast])

  const handleBulletContextMenu = useCallback((e: React.MouseEvent, uuid: string) => {
    // Block references are disabled for encrypted gardens
    if (isEncrypted) return

    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, uuid })
  }, [isEncrypted])

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  // ─────────────────────────────────────────────────────────────────────────
  // SEED BOUNDARY EVENT HANDLER
  // ─────────────────────────────────────────────────────────────────────────

  const handleBoundaryEvent = useCallback((uuid: string, event: SeedBoundaryEvent) => {
    switch (event.type) {
      case 'enter': {
        if (event.cursorOffset === 0 && event.content.length > 0) {
          // Cursor at start of non-empty block: create empty block BEFORE, keep current content
          const newUuid = handleCreateBlockBefore(uuid)
          focusBlock(newUuid, 'start')
        } else {
          // Split block at cursor (or create after for empty blocks).
          // Uses handleSplitBlock to truncate and create in a single state
          // update, avoiding a race where the second call reads stale state.
          const contentBefore = event.content.substring(0, event.cursorOffset)
          const contentAfter = event.content.substring(event.cursorOffset)

          const newUuid = handleSplitBlock(uuid, contentBefore, contentAfter)
          focusBlock(newUuid, 'start')
        }
        break
      }

      case 'backspace-at-start':
        handleMergeWithPrevious(uuid)
        break

      case 'delete-at-end':
        handleMergeWithNext(uuid)
        break

      case 'arrow-up':
        navigateUp(uuid, event.cursorOffset)
        break

      case 'arrow-down':
        navigateDown(uuid, event.cursorOffset)
        break

      case 'arrow-left-at-start':
        navigateUp(uuid, 'end' as unknown as number) // Will be interpreted as 'end'
        break

      case 'arrow-right-at-end':
        navigateDown(uuid, 'start' as unknown as number) // Will be interpreted as 'start'
        break

      case 'tab':
        handleIndent(uuid)
        // Refocus same block after indent
        requestAnimationFrame(() => focusBlock(uuid, 'start'))
        break

      case 'shift-tab':
        handleOutdent(uuid)
        // Refocus same block after outdent
        requestAnimationFrame(() => focusBlock(uuid, 'start'))
        break

      case 'alt-arrow-up':
        handleMoveUp(uuid)
        // Refocus same block after move
        requestAnimationFrame(() => focusBlock(uuid, 'start'))
        break

      case 'alt-arrow-down':
        handleMoveDown(uuid)
        // Refocus same block after move
        requestAnimationFrame(() => focusBlock(uuid, 'start'))
        break

      case 'shift-arrow-up': {
        const freshOrder = getFreshFlatBlockOrder()
        extendSelectionInDirection('up', freshOrder)
        break
      }

      case 'shift-arrow-down': {
        const freshOrder = getFreshFlatBlockOrder()
        extendSelectionInDirection('down', freshOrder)
        break
      }
    }
  }, [
    handleSplitBlock,
    handleCreateBlockBefore,
    handleMergeWithPrevious,
    handleMergeWithNext,
    navigateUp,
    navigateDown,
    extendSelectionInDirection,
    getFreshFlatBlockOrder,
    handleIndent,
    handleOutdent,
    handleMoveUp,
    handleMoveDown,
    focusBlock,
  ])

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  // Detect markdown header and extract level (1-6)
  const getHeaderLevel = (content: string): number | null => {
    const match = content.match(/^(#{1,6})\s/)
    return match ? match[1].length : null
  }

  // Detect if block content is purely a block reference ((uuid))
  // Used to hide the bullet when the chain icon replaces it
  const isBlockReference = (content: string): boolean => {
    const trimmed = content.trim()
    // Match exactly: ((uuid)) where uuid is 8-4-4-4-12 hex format
    return /^\(\([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\)\)$/i.test(trimmed)
  }

  const renderBlock = (block: Block) => {
    const blockChildren = block.children
      .map((childUuid) => page.blocks[childUuid])
      .filter(Boolean)
    const hasChildren = block.children.length > 0
    const isSelected = block.uuid === selectedUuid
    const isInMultiSelection = isInSelection(block.uuid, flatBlockOrder)

    // Check if block is a header
    const headerLevel = getHeaderLevel(block.content)
    const isHeader = headerLevel !== null

    // Check if block is part of a code fence
    const codeInfo = codeFenceMap.get(block.uuid)
    const isCodeBlock = codeInfo?.isCodeBlock ?? false
    const isCodeStart = codeInfo?.isStart ?? false
    const isCodeEnd = codeInfo?.isEnd ?? false
    const codeLanguage = codeInfo?.language ?? ''

    // Check if block is a block reference (content is purely ((uuid)))
    // Hide bullet because the chain icon replaces it
    const isBlockRef = isBlockReference(block.content)

    // Check if block is a task (TODO, DOING, DONE, NOW, LATER, NEVER)
    const isTask = TASK_STATUS_REGEX.test(block.content)
    const taskStatusMatch = isTask ? block.content.match(TASK_STATUS_REGEX) : null
    const isTaskCompleted = taskStatusMatch?.[1] === 'DONE' || taskStatusMatch?.[1] === 'NEVER'

    // Hide bullet for headers, code blocks, and block references
    const hideBullet = isHeader || isCodeBlock || isBlockRef

    // Build class names for the block container
    const containerClasses = [
      'block-container',
      isInMultiSelection ? 'block-container--selected' : '',
      isHeader ? 'block-container--header' : '',
      isHeader ? `block-container--header-${headerLevel}` : '',
      isCodeBlock ? 'block-container--code' : '',
      isCodeStart ? 'block-container--code-start' : '',
      isCodeEnd ? 'block-container--code-end' : '',
      isBlockRef ? 'block-container--block-ref' : '',
    ].filter(Boolean).join(' ')

    // Code blocks need to break out of nesting indentation to be full width
    // Each nesting level adds 36px (ml-6=24px + pl-3=12px)
    const codeBlockStyle = isCodeBlock && block.depth > 0
      ? { marginLeft: `calc(-${block.depth} * 36px)` }
      : undefined

    return (
      <div
        key={block.uuid}
        className={containerClasses}
        style={codeBlockStyle}
        data-block-id={block.uuid}
        data-code-language={isCodeBlock ? codeLanguage : undefined}
        onClick={(e) => {
          // Let CodeMirror handle clicks inside the editor completely
          const target = e.target as HTMLElement
          if (target.closest('[data-seed-editor]')) {
            // Inside the editor - stop propagation but do NOTHING else
            // CodeMirror handles focus and cursor placement natively
            e.stopPropagation()
            return
          }
          // Outside editor (e.g., container padding) - focus at end
          focusBlock(block.uuid, 'end')
        }}
      >
        <div className="block flex items-start py-0.5">
          {/* Bullet - hidden for headers, code blocks, and block references */}
          {!hideBullet && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (hasChildren) handleToggleCollapse(block.uuid)
              }}
              onContextMenu={(e) => handleBulletContextMenu(e, block.uuid)}
              className={`bullet mt-[0.55rem] ${
                hasChildren ? (block.collapsed ? 'bullet--collapsed' : '') : ''
              }`}
            />
          )}

          {/* Seed - editable content */}
          <div className={`flex-1 ${isCodeBlock ? 'code-content' : ''} ${isTask ? 'task-block-container' : ''}`}>
            <Seed
              block={block}
              isSelected={isSelected}
              onChange={(content) => handleBlockChange(block.uuid, content)}
              onBoundaryEvent={(event) => handleBoundaryEvent(block.uuid, event)}
              onFocus={() => {
                // Update selection state when CodeMirror gets focus
                // This happens AFTER CodeMirror handles the click, not during
                setSelectedUuid(block.uuid)
                setFocusedBlock(block.uuid)
                clearSelection()
              }}
              readonly={readonly}
              isCodeBlock={isCodeBlock}
              codeLanguage={codeLanguage}
              isActive={block.uuid === activeBlockUuid}
              onActivate={(cursorOffset) => {
                setActiveBlockUuid(block.uuid)
                setSelectedUuid(block.uuid)
                setFocusedBlock(block.uuid)
                setLastFocusedBlockUuid(block.uuid)
                clearSelection()
                // Store cursor offset for initialCursorPosition on next render
                pendingCursorPositionRef.current = cursorOffset
              }}
              onDeactivate={() => setActiveBlockUuid(null)}
              initialCursorPosition={
                block.uuid === activeBlockUuid
                  ? pendingCursorPositionRef.current
                  : undefined
              }
            />
            {/* Task metadata - shown below task content */}
            {isTask && !readonly && (
              <TaskMetadata
                blockUuid={block.uuid}
                properties={block.properties}
                onPropertyChange={(key, value) => handleBlockPropertyChange(block.uuid, key, value)}
                isCompleted={isTaskCompleted}
              />
            )}
          </div>
        </div>

        {/* Children */}
        {!block.collapsed && blockChildren.length > 0 && (
          <div className="block-children ml-6 pl-3 border-l border-base-02">
            {blockChildren.map((child) => renderBlock(child))}
          </div>
        )}
      </div>
    )
  }

  // Create initial empty block if page is empty (only on initial render)
  const hasCreatedInitialBlock = useRef(false)
  useEffect(() => {
    // Only create initial block once per page load, and only if truly empty
    if (rootBlocks.length === 0 && !hasCreatedInitialBlock.current) {
      hasCreatedInitialBlock.current = true
      const initialBlock: Block = {
        uuid: uuidv4(),
        content: '',
        parentUuid: null,
        children: [],
        collapsed: false,
        properties: {},
        depth: 0,
      }
      updateCurrentPage([initialBlock])
    } else if (rootBlocks.length > 0) {
      // Reset the flag if blocks exist (page was loaded with content)
      hasCreatedInitialBlock.current = false
    }
  }, [rootBlocks.length, updateCurrentPage])

  // Auto-select first block
  useEffect(() => {
    if (!selectedUuid && flatBlockOrder.length > 0) {
      setSelectedUuid(flatBlockOrder[0])
    }
  }, [selectedUuid, flatBlockOrder])

  // Handle pending cursor position from template creation
  // This effect runs when the page loads and consumes the cursor position
  // We track the last page name we checked to avoid re-running on every render
  const lastCheckedPageRef = useRef<string | null>(null)
  useEffect(() => {
    // Skip if blocks aren't loaded yet
    if (flatBlockOrder.length === 0) {
      return
    }

    // Skip if we've already checked for cursor position on THIS page
    if (lastCheckedPageRef.current === page.name) {
      return
    }

    // Mark this page as checked (even if no cursor position)
    lastCheckedPageRef.current = page.name

    // Check for pending cursor position (from template with {{cursor}} marker)
    const cursorPosition = consumePendingCursorPosition()
    if (cursorPosition) {
      // Focus the block at the specified offset
      focusBlock(cursorPosition.blockUuid, cursorPosition.offset)
    }
  }, [flatBlockOrder.length, page.name, consumePendingCursorPosition, focusBlock])

  // Handle pending scroll target from sidebar task click or block reference navigation
  // Scrolls to and highlights the target block
  const lastScrollTargetPageRef = useRef<string | null>(null)
  useEffect(() => {
    // Skip if blocks aren't loaded yet
    if (flatBlockOrder.length === 0) {
      return
    }

    // Skip if we've already checked for scroll target on THIS page
    if (lastScrollTargetPageRef.current === page.name) {
      return
    }

    // Mark this page as checked
    lastScrollTargetPageRef.current = page.name

    // Check for pending scroll target
    const scrollTarget = consumePendingScrollTarget()
    if (scrollTarget && flatBlockOrder.includes(scrollTarget)) {
      // Scroll to and focus the block
      requestAnimationFrame(() => {
        const blockEl = document.querySelector(`[data-block-id="${scrollTarget}"]`)
        if (blockEl) {
          // Scroll block into view
          blockEl.scrollIntoView({ behavior: 'smooth', block: 'center' })

          // Add highlight effect
          blockEl.classList.add('block-container--highlight')
          setTimeout(() => {
            blockEl.classList.remove('block-container--highlight')
          }, 2000)

          // Focus the block at the start
          focusBlock(scrollTarget, 'start')
        }
      })
    }
  }, [flatBlockOrder, page.name, consumePendingScrollTarget, focusBlock])

  // Update last focused block when selection changes (backup for non-focusBlock selection changes)
  useEffect(() => {
    if (selectedUuid) {
      setLastFocusedBlockUuid(selectedUuid)
    }
  }, [selectedUuid, setLastFocusedBlockUuid])

  // Track last-active block so keyboard re-activation returns to the right place
  useEffect(() => {
    if (activeBlockUuid) {
      lastActiveBlockUuidRef.current = activeBlockUuid
    }
  }, [activeBlockUuid])

  // Keyboard handler: when all seeds are dormant and the container has focus,
  // activate a block on keypress so the user can start typing immediately.
  const handleContainerKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Only handle when no seed is active (all dormant)
    if (activeBlockUuid !== null) return
    if (flatBlockOrder.length === 0) return
    if (readonly) return

    // Don't intercept modifier-only keys, Tab, or Escape
    if (e.key === 'Tab' || e.key === 'Escape' || e.key === 'Shift' ||
        e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return

    // Don't intercept keyboard shortcuts (Ctrl/Cmd+key, Alt+Shift+key)
    if (e.ctrlKey || e.metaKey || (e.altKey && e.shiftKey)) return

    const targetUuid = lastActiveBlockUuidRef.current && flatBlockOrder.includes(lastActiveBlockUuidRef.current)
      ? lastActiveBlockUuidRef.current
      : null

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusBlock(targetUuid || flatBlockOrder[0], 'start')
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusBlock(targetUuid || flatBlockOrder[flatBlockOrder.length - 1], 'end')
    } else if (e.key === 'Enter') {
      e.preventDefault()
      focusBlock(targetUuid || flatBlockOrder[0], 'end')
    } else if (e.key.length === 1 && !e.altKey) {
      // Printable character - activate last-focused or first block
      // Don't preventDefault: let the character be typed into the newly activated editor.
      // focusBlock sets initialCursorPosition; the key event will be handled by CodeMirror
      // after it mounts.
      e.preventDefault()
      const uuid = targetUuid || flatBlockOrder[0]
      const block = page.blocks[uuid]
      if (block) {
        // Activate the block at the end, then insert the character via seed-insert-text
        focusBlock(uuid, 'end')
        // Schedule text insertion after CodeMirror mounts
        const insertChar = () => {
          const blockEl = document.querySelector(`[data-block-id="${uuid}"]`)
          const editorEl = blockEl?.querySelector('[data-seed-editor]') as HTMLElement
          if (editorEl?.querySelector('.cm-editor')) {
            const evt = new CustomEvent('seed-insert-text', {
              detail: { text: e.key },
              bubbles: false,
            })
            editorEl.dispatchEvent(evt)
          } else {
            // CodeMirror not yet mounted, retry
            requestAnimationFrame(insertChar)
          }
        }
        requestAnimationFrame(insertChar)
      }
    }
  }, [activeBlockUuid, flatBlockOrder, readonly, focusBlock, page.blocks])

  // Register insertTextAtCursor callback with UI store.
  // When a seed is active, dispatches seed-insert-text directly.
  // When all seeds are dormant, activates the target seed first, then inserts.
  const setInsertTextAtCursor = useUIStore((state) => state.setInsertTextAtCursor)
  const activeBlockUuidRef = useRef(activeBlockUuid)
  activeBlockUuidRef.current = activeBlockUuid
  const focusBlockRef = useRef(focusBlock)
  focusBlockRef.current = focusBlock

  useEffect(() => {
    const insertText = (text: string) => {
      // First try to find a currently focused/active editor (has CodeMirror)
      const activeEl = document.activeElement
      let seedEditor = activeEl?.closest('[data-seed-editor]') || document.querySelector('[data-seed-editor]:focus-within')

      // Check if this editor is actually active (has CodeMirror, not dormant)
      if (seedEditor && seedEditor.querySelector('.cm-editor')) {
        const event = new CustomEvent('seed-insert-text', {
          detail: { text },
          bubbles: false,
        })
        seedEditor.dispatchEvent(event)
        return
      }

      // No active editor - need to activate a seed first, then insert
      const targetUuid = useUIStore.getState().lastFocusedBlockUuid
      if (!targetUuid) return

      // Activate the target block
      focusBlockRef.current(targetUuid, 'end')

      // Poll for CodeMirror to mount, then insert text
      let attempts = 0
      const tryInsert = () => {
        const blockEl = document.querySelector(`[data-block-id="${targetUuid}"]`)
        const editorEl = blockEl?.querySelector('[data-seed-editor]') as HTMLElement
        if (editorEl?.querySelector('.cm-editor')) {
          const event = new CustomEvent('seed-insert-text', {
            detail: { text },
            bubbles: false,
          })
          editorEl.dispatchEvent(event)
        } else if (attempts < 10) {
          attempts++
          requestAnimationFrame(tryInsert)
        }
      }
      requestAnimationFrame(tryInsert)
    }

    setInsertTextAtCursor(insertText)

    return () => {
      setInsertTextAtCursor(null)
    }
  }, [setInsertTextAtCursor])

  // Keyboard shortcut: Alt+Shift+R to copy block reference
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Alt+Shift+R: Copy block reference for focused block
      if (e.altKey && e.shiftKey && e.code === 'KeyR') {
        e.preventDefault()
        // Use selectedUuid (currently focused/selected block)
        if (selectedUuid) {
          copyBlockReference(selectedUuid)
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedUuid, copyBlockReference])

  // ─────────────────────────────────────────────────────────────────────────
  // CROSS-BLOCK COPY
  // Intercept copy when selection spans multiple dormant blocks to provide
  // source markdown instead of rendered HTML.
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleCopy = (e: ClipboardEvent) => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return

      const range = selection.getRangeAt(0)

      // Walk up from start and end nodes to find their block containers
      const findBlockContainer = (node: Node): HTMLElement | null => {
        let el = node instanceof HTMLElement ? node : node.parentElement
        while (el && el !== container) {
          if (el.hasAttribute('data-block-id')) return el
          el = el.parentElement
        }
        return null
      }

      const startBlock = findBlockContainer(range.startContainer)
      const endBlock = findBlockContainer(range.endContainer)

      // If selection is entirely within one block, let the default handler
      // (or CodeMirror) deal with it
      if (!startBlock || !endBlock || startBlock === endBlock) return

      // Selection spans multiple blocks - intercept and provide source markdown
      const startUuid = startBlock.getAttribute('data-block-id')!
      const endUuid = endBlock.getAttribute('data-block-id')!

      // Gather all block containers between start and end in DOM order
      const allBlockEls = container.querySelectorAll('[data-block-id]')
      const blockUuids: string[] = []
      let inRange = false
      for (const el of allBlockEls) {
        const uuid = el.getAttribute('data-block-id')!
        if (uuid === startUuid) inRange = true
        if (inRange) blockUuids.push(uuid)
        if (uuid === endUuid) break
      }

      if (blockUuids.length === 0) return

      // Compute the rendered text offset within a block container's seed element.
      // Walks the text nodes of the seed element to find the total offset of the
      // given node + local offset within the rendered text.
      const getRenderedOffsetInBlock = (blockEl: HTMLElement, node: Node, localOffset: number): number => {
        const seedEl = blockEl.querySelector('[data-seed-editor]')
        if (!seedEl) return 0

        let totalOffset = 0
        const walker = document.createTreeWalker(seedEl, NodeFilter.SHOW_TEXT)
        let textNode: Node | null
        while ((textNode = walker.nextNode())) {
          if (textNode === node) {
            return totalOffset + localOffset
          }
          totalOffset += (textNode.textContent?.length ?? 0)
        }
        // node not found in this seed - return total length (end of block)
        return totalOffset
      }

      const fragments: string[] = []

      for (let i = 0; i < blockUuids.length; i++) {
        const uuid = blockUuids[i]
        const block = page.blocks[uuid]
        if (!block) continue

        const content = block.content
        const isFirst = i === 0
        const isLast = i === blockUuids.length - 1

        if (isFirst && isLast) {
          // Should not happen (same block case caught above), but handle defensively
          fragments.push(content)
        } else if (isFirst) {
          // Partial: selection starts partway through this block
          const renderedOffset = getRenderedOffsetInBlock(startBlock, range.startContainer, range.startOffset)
          const tokens = parseContent(content)
          const sourceOffset = mapRenderedOffsetToSource(tokens, renderedOffset)
          fragments.push(content.slice(sourceOffset))
        } else if (isLast) {
          // Partial: selection ends partway through this block
          const renderedOffset = getRenderedOffsetInBlock(endBlock, range.endContainer, range.endOffset)
          const tokens = parseContent(content)
          const sourceOffset = mapRenderedOffsetToSource(tokens, renderedOffset)
          fragments.push(content.slice(0, sourceOffset))
        } else {
          // Middle block: include full content
          fragments.push(content)
        }
      }

      const markdownContent = fragments.join('\n')

      e.clipboardData?.setData('text/plain', markdownContent)
      e.clipboardData?.setData('text/html', selection.toString())
      e.preventDefault()
    }

    container.addEventListener('copy', handleCopy)
    return () => container.removeEventListener('copy', handleCopy)
  }, [page.blocks])

  if (rootBlocks.length === 0) {
    return (
      <div className="outliner-editor max-w-3xl">
        <div className="text-base-03 text-sm">Loading...</div>
      </div>
    )
  }

  // Check if page is in free text mode (bullets hidden, no indentation)
  const isFreeTextMode = page.properties?.freeText === 'true'

  // Deactivate all seeds when clicking empty space in the container
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    // Only deactivate if the click target is the container itself,
    // not a child element (block, seed, bullet, etc.)
    if (e.target === e.currentTarget) {
      setActiveBlockUuid(null)
      // Focus the container so it can receive keyboard events
      containerRef.current?.focus()
    }
  }, [])

  return (
    <>
      <div
        ref={containerRef}
        tabIndex={-1}
        className={`outliner-editor max-w-3xl outline-none ${isFreeTextMode ? 'outliner-editor--free-text' : ''}`}
        onClick={handleContainerClick}
        onKeyDown={handleContainerKeyDown}
      >
        {rootBlocks.map((block) => renderBlock(block))}
      </div>

      {/* Block context menu for copying block references */}
      {contextMenu && (
        <BlockContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          uuid={contextMenu.uuid}
          onClose={handleCloseContextMenu}
        />
      )}
    </>
  )
}

// Re-export as OutlinerEditor for drop-in compatibility
export { Plots as OutlinerEditor }
