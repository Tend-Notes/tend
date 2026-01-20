// SPDX-License-Identifier: MIT WITH Commons-Clause
// Main outliner editor component

import { useCallback, useMemo, useEffect } from 'react'
import { LayoutGroup } from 'framer-motion'
import type { Page, Block } from '../../types'
import { usePageStore } from '../../stores/pageStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { BlockComponent } from './Block'
import { v4 as uuidv4 } from 'uuid'

interface OutlinerEditorProps {
  page: Page
}

export function OutlinerEditor({ page }: OutlinerEditorProps) {
  const updateCurrentPage = usePageStore((state) => state.updateCurrentPage)
  const { getSelectedUuids, hasMultiBlockSelection, clearSelection } = useSelectionStore()

  // Get blocks in tree order for rendering
  const rootBlocks = useMemo(() => {
    return page.rootBlocks
      .map((uuid) => page.blocks[uuid])
      .filter(Boolean)
  }, [page.rootBlocks, page.blocks])

  // Convert blocks object to array for saving
  const getAllBlocks = useCallback((): Block[] => {
    return Object.values(page.blocks)
  }, [page.blocks])

  // Update a single block's content
  const handleBlockChange = useCallback(
    (uuid: string, content: string) => {
      const blocks = getAllBlocks()
      const updatedBlocks = blocks.map((block) =>
        block.uuid === uuid ? { ...block, content } : block
      )
      updateCurrentPage(updatedBlocks)
    },
    [getAllBlocks, updateCurrentPage]
  )

  // Create a new block after the given block
  // If the current block has children, insert as first child instead of sibling
  const handleCreateBlock = useCallback(
    (afterUuid: string, contentForNewBlock?: string) => {
      // Deep clone blocks to avoid mutating frozen Zustand state
      const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
      const afterBlock = blocks.find((b) => b.uuid === afterUuid)
      if (!afterBlock) return

      // If current block has children, new block becomes first child
      const hasChildren = afterBlock.children.length > 0 && !afterBlock.collapsed

      const newBlock: Block = {
        uuid: uuidv4(),
        content: contentForNewBlock || '',
        parentUuid: hasChildren ? afterUuid : afterBlock.parentUuid,
        children: [],
        collapsed: false,
        properties: {},
        depth: hasChildren ? afterBlock.depth + 1 : afterBlock.depth,
      }

      if (hasChildren) {
        // Insert as first child of current block
        afterBlock.children = [newBlock.uuid, ...afterBlock.children]
        updateCurrentPage([...blocks, newBlock])
      } else if (afterBlock.parentUuid) {
        // Insert as sibling after current block (non-root)
        const parent = blocks.find((b) => b.uuid === afterBlock.parentUuid)
        if (parent) {
          const afterIndex = parent.children.indexOf(afterUuid)
          parent.children = [
            ...parent.children.slice(0, afterIndex + 1),
            newBlock.uuid,
            ...parent.children.slice(afterIndex + 1),
          ]
        }
        updateCurrentPage([...blocks, newBlock])
      } else {
        // Root-level block: need to insert in rootBlocks after this block
        // We handle this by directly updating rootBlocks via setState
        const afterIndex = page.rootBlocks.indexOf(afterUuid)
        const newRootBlocks = [
          ...page.rootBlocks.slice(0, afterIndex + 1),
          newBlock.uuid,
          ...page.rootBlocks.slice(afterIndex + 1),
        ]
        usePageStore.setState((state) => {
          if (state.currentPage) {
            state.currentPage.rootBlocks = newRootBlocks
          }
        })
        updateCurrentPage([...blocks, newBlock])
      }
      return newBlock.uuid
    },
    [getAllBlocks, updateCurrentPage, page.rootBlocks]
  )

  // Delete a block (merge with previous if at start)
  const handleDeleteBlock = useCallback(
    (uuid: string) => {
      // Deep clone blocks to avoid mutating frozen Zustand state
      const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
      if (blocks.length <= 1) return // Don't delete the last block

      const blockToDelete = blocks.find((b) => b.uuid === uuid)
      if (!blockToDelete) return

      // Remove from parent's children
      if (blockToDelete.parentUuid) {
        const parent = blocks.find((b) => b.uuid === blockToDelete.parentUuid)
        if (parent) {
          parent.children = parent.children.filter((id) => id !== uuid)
        }
      }

      // Remove the block
      const updatedBlocks = blocks.filter((b) => b.uuid !== uuid)
      updateCurrentPage(updatedBlocks)
    },
    [getAllBlocks, updateCurrentPage]
  )

  // Focus a block's editor and position cursor
  // position can be: 'start', 'end', or a number for specific character offset
  const focusBlock = useCallback((blockUuid: string, position: 'start' | 'end' | number) => {
    requestAnimationFrame(() => {
      const blockEl = document.querySelector(`[data-block-id="${blockUuid}"]`)
      const editorEl = blockEl?.querySelector('[contenteditable]') as HTMLElement
      if (!editorEl) return

      editorEl.focus()

      const selection = window.getSelection()
      if (!selection) return

      const range = document.createRange()
      const text = editorEl.textContent || ''

      if (text.length === 0) {
        range.selectNodeContents(editorEl)
        range.collapse(true)
      } else {
        let targetOffset: number
        if (position === 'end') {
          targetOffset = text.length
        } else if (position === 'start') {
          targetOffset = 0
        } else {
          targetOffset = Math.max(0, Math.min(position, text.length))
        }

        // Walk through text nodes to find the right position
        // (handles mixed content like wiki-link spans)
        const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT)
        let currentOffset = 0
        let node: Text | null
        let found = false

        while ((node = walker.nextNode() as Text | null)) {
          const nodeLength = node.textContent?.length || 0
          if (currentOffset + nodeLength >= targetOffset) {
            range.setStart(node, targetOffset - currentOffset)
            range.setEnd(node, targetOffset - currentOffset)
            found = true
            break
          }
          currentOffset += nodeLength
        }

        if (!found) {
          range.selectNodeContents(editorEl)
          range.collapse(false)
        }
      }

      selection.removeAllRanges()
      selection.addRange(range)
    })
  }, [])

  // Indent a block (make it a child of the previous sibling)
  const handleIndent = useCallback(
    (uuid: string) => {
      // Deep clone blocks to avoid mutating frozen Zustand state
      const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
      const block = blocks.find((b) => b.uuid === uuid)
      if (!block) return

      // Find siblings
      const siblings = block.parentUuid
        ? blocks.find((b) => b.uuid === block.parentUuid)?.children || []
        : page.rootBlocks

      const currentIndex = siblings.indexOf(uuid)
      if (currentIndex <= 0) return // Can't indent if first child

      const newParentUuid = siblings[currentIndex - 1]
      const newParent = blocks.find((b) => b.uuid === newParentUuid)
      if (!newParent) return

      // Remove from current parent's children
      if (block.parentUuid) {
        const oldParent = blocks.find((b) => b.uuid === block.parentUuid)
        if (oldParent) {
          oldParent.children = oldParent.children.filter((id) => id !== uuid)
        }
      }

      // Add to new parent's children
      newParent.children = [...newParent.children, uuid]
      block.parentUuid = newParentUuid
      block.depth += 1

      // Update children depths recursively
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

      updateCurrentPage(blocks)

      // Restore focus after re-render
      focusBlock(uuid, 'start')
    },
    [getAllBlocks, page.rootBlocks, updateCurrentPage, focusBlock]
  )

  // Outdent a block (move to parent's level)
  const handleOutdent = useCallback(
    (uuid: string) => {
      // Deep clone blocks to avoid mutating frozen Zustand state
      const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
      const block = blocks.find((b) => b.uuid === uuid)
      if (!block || !block.parentUuid) return // Can't outdent root blocks

      const parent = blocks.find((b) => b.uuid === block.parentUuid)
      if (!parent) return

      // Remove from parent's children
      parent.children = parent.children.filter((id) => id !== uuid)

      // Update block's parent to grandparent (null if parent was root)
      const newParentUuid = parent.parentUuid
      block.parentUuid = newParentUuid
      block.depth = Math.max(0, block.depth - 1)

      // If grandparent exists, add to its children after the parent
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
      }

      // Update children depths recursively
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

      updateCurrentPage(blocks)

      // Restore focus after re-render
      focusBlock(uuid, 'start')
    },
    [getAllBlocks, updateCurrentPage, focusBlock]
  )

  // Toggle block collapsed state
  const handleToggleCollapse = useCallback(
    (uuid: string) => {
      const blocks = getAllBlocks().map((b) =>
        b.uuid === uuid ? { ...b, collapsed: !b.collapsed } : b
      )
      updateCurrentPage(blocks)
    },
    [getAllBlocks, updateCurrentPage]
  )

  // Get flattened list of blocks in document order for navigation
  const getFlattenedBlocks = useCallback((): Block[] => {
    const result: Block[] = []
    const traverse = (blockUuids: string[]) => {
      for (const uuid of blockUuids) {
        const block = page.blocks[uuid]
        if (block) {
          result.push(block)
          if (!block.collapsed && block.children.length > 0) {
            traverse(block.children)
          }
        }
      }
    }
    traverse(page.rootBlocks)
    return result
  }, [page.blocks, page.rootBlocks])

  // Memoized flat block order for selection (just UUIDs)
  const flatBlockOrder = useMemo(() => {
    return getFlattenedBlocks().map((b) => b.uuid)
  }, [getFlattenedBlocks])

  // Delete multiple selected blocks
  const deleteSelectedBlocks = useCallback(() => {
    const selectedUuids = getSelectedUuids(flatBlockOrder)
    if (selectedUuids.length === 0) return

    // Deep clone blocks
    let blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))

    // Don't delete if it would remove all blocks
    if (selectedUuids.length >= blocks.length) {
      // Keep one empty block
      const firstUuid = selectedUuids[0]
      blocks = blocks.map((b) =>
        b.uuid === firstUuid ? { ...b, content: '', children: [] } : b
      )
      blocks = blocks.filter((b) => b.uuid === firstUuid)
      updateCurrentPage(blocks)
      clearSelection()
      return
    }

    // Remove selected blocks from their parents' children arrays
    for (const uuid of selectedUuids) {
      const block = blocks.find((b) => b.uuid === uuid)
      if (block?.parentUuid) {
        const parent = blocks.find((b) => b.uuid === block.parentUuid)
        if (parent) {
          parent.children = parent.children.filter((id) => id !== uuid)
        }
      }
    }

    // Filter out selected blocks
    const selectedSet = new Set(selectedUuids)
    blocks = blocks.filter((b) => !selectedSet.has(b.uuid))

    updateCurrentPage(blocks)
    clearSelection()

    // Focus the block after the selection (or before if at end)
    const lastSelectedIndex = flatBlockOrder.indexOf(selectedUuids[selectedUuids.length - 1])
    const nextBlockUuid = flatBlockOrder[lastSelectedIndex + 1] || flatBlockOrder[lastSelectedIndex - selectedUuids.length]
    if (nextBlockUuid && !selectedSet.has(nextBlockUuid)) {
      focusBlock(nextBlockUuid, 'start')
    }
  }, [getSelectedUuids, flatBlockOrder, getAllBlocks, updateCurrentPage, clearSelection, focusBlock])

  // Serialize blocks to markdown format
  const blocksToMarkdown = useCallback((blockUuids: string[]): string => {
    const lines: string[] = []

    const serializeBlock = (uuid: string, indent: number) => {
      const block = page.blocks[uuid]
      if (!block) return

      const prefix = '  '.repeat(indent) + '- '
      lines.push(prefix + block.content)

      // Serialize children
      for (const childUuid of block.children) {
        serializeBlock(childUuid, indent + 1)
      }
    }

    // Find root-level blocks among the selection (blocks whose parent isn't in selection)
    const selectedSet = new Set(blockUuids)
    const rootUuids = blockUuids.filter((uuid) => {
      const block = page.blocks[uuid]
      return !block?.parentUuid || !selectedSet.has(block.parentUuid)
    })

    for (const uuid of rootUuids) {
      serializeBlock(uuid, 0)
    }

    return lines.join('\n')
  }, [page.blocks])

  // Copy selected blocks to clipboard
  const copySelectedBlocks = useCallback(async () => {
    const selectedUuids = getSelectedUuids(flatBlockOrder)
    if (selectedUuids.length === 0) return

    const markdown = blocksToMarkdown(selectedUuids)
    await navigator.clipboard.writeText(markdown)
  }, [getSelectedUuids, flatBlockOrder, blocksToMarkdown])

  // Cut selected blocks (copy + delete)
  const cutSelectedBlocks = useCallback(async () => {
    await copySelectedBlocks()
    deleteSelectedBlocks()
  }, [copySelectedBlocks, deleteSelectedBlocks])

  // Paste blocks from clipboard after the focused block
  const pasteBlocks = useCallback(async (afterUuid: string) => {
    const text = await navigator.clipboard.readText()
    if (!text) return

    // Parse markdown into blocks
    const lines = text.split('\n').filter((line) => line.trim())
    if (lines.length === 0) return

    // Deep clone blocks
    const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
    const afterBlock = blocks.find((b) => b.uuid === afterUuid)
    if (!afterBlock) return

    // Parse indentation and create block hierarchy
    interface ParsedLine {
      content: string
      indent: number
    }

    const parsedLines: ParsedLine[] = lines.map((line) => {
      // Count leading spaces/tabs before the bullet
      const match = line.match(/^(\s*)(?:-\s*)?(.*)$/)
      if (match) {
        const spaces = match[1]
        const content = match[2]
        // Each 2 spaces = 1 indent level
        const indent = Math.floor(spaces.length / 2)
        return { content, indent }
      }
      return { content: line.trim(), indent: 0 }
    })

    // Create new blocks
    const newBlocks: Block[] = []
    const uuidStack: { uuid: string; indent: number }[] = []

    // Determine base indent (minimum indent in parsed lines)
    const baseIndent = Math.min(...parsedLines.map((l) => l.indent))

    for (const { content, indent } of parsedLines) {
      const relativeIndent = indent - baseIndent

      // Find parent from stack
      while (uuidStack.length > 0 && uuidStack[uuidStack.length - 1].indent >= relativeIndent) {
        uuidStack.pop()
      }

      const parentUuid = uuidStack.length > 0 ? uuidStack[uuidStack.length - 1].uuid : null
      const parentBlock = parentUuid ? blocks.find((b) => b.uuid === parentUuid) || newBlocks.find((b) => b.uuid === parentUuid) : null

      const newBlock: Block = {
        uuid: uuidv4(),
        content,
        parentUuid,
        children: [],
        collapsed: false,
        properties: {},
        depth: parentBlock ? parentBlock.depth + 1 : afterBlock.depth,
      }

      // Add to parent's children
      if (parentBlock) {
        parentBlock.children.push(newBlock.uuid)
      }

      newBlocks.push(newBlock)
      uuidStack.push({ uuid: newBlock.uuid, indent: relativeIndent })
    }

    // Find root-level pasted blocks (those without a parent in newBlocks)
    const pastedRootUuids = newBlocks
      .filter((b) => !b.parentUuid)
      .map((b) => b.uuid)

    // Insert pasted root blocks after afterBlock
    if (afterBlock.parentUuid) {
      const parent = blocks.find((b) => b.uuid === afterBlock.parentUuid)
      if (parent) {
        const afterIndex = parent.children.indexOf(afterUuid)
        parent.children = [
          ...parent.children.slice(0, afterIndex + 1),
          ...pastedRootUuids,
          ...parent.children.slice(afterIndex + 1),
        ]
        // Update parent UUID for pasted root blocks
        for (const uuid of pastedRootUuids) {
          const pastedBlock = newBlocks.find((b) => b.uuid === uuid)
          if (pastedBlock) {
            pastedBlock.parentUuid = afterBlock.parentUuid
            pastedBlock.depth = afterBlock.depth
          }
        }
      }
    }

    // Update depths for all pasted blocks
    const updateDepths = (blockList: Block[]) => {
      for (const block of blockList) {
        if (block.parentUuid) {
          const parent = blocks.find((b) => b.uuid === block.parentUuid) || newBlocks.find((b) => b.uuid === block.parentUuid)
          if (parent) {
            block.depth = parent.depth + 1
          }
        }
      }
    }
    updateDepths(newBlocks)

    updateCurrentPage([...blocks, ...newBlocks])

    // Focus the last pasted block
    if (newBlocks.length > 0) {
      focusBlock(newBlocks[newBlocks.length - 1].uuid, 'end')
    }
  }, [getAllBlocks, updateCurrentPage, focusBlock])

  // End drag selection on mouseup anywhere
  const endDrag = useSelectionStore((state) => state.endDrag)

  useEffect(() => {
    const handleMouseUp = () => {
      endDrag()
    }

    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [endDrag])

  // Handle keyboard shortcuts for selection operations
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't interfere if user is typing in an input/textarea
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      // Only handle Delete/Backspace when we have multi-block selection
      if ((e.key === 'Delete' || e.key === 'Backspace') && hasMultiBlockSelection(flatBlockOrder)) {
        e.preventDefault()
        deleteSelectedBlocks()
        return
      }

      // Copy (Ctrl+C / Cmd+C) when we have multi-block selection
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && hasMultiBlockSelection(flatBlockOrder)) {
        e.preventDefault()
        copySelectedBlocks()
        return
      }

      // Cut (Ctrl+X / Cmd+X) when we have multi-block selection
      if ((e.ctrlKey || e.metaKey) && e.key === 'x' && hasMultiBlockSelection(flatBlockOrder)) {
        e.preventDefault()
        cutSelectedBlocks()
        return
      }

      // Escape clears selection
      if (e.key === 'Escape' && hasMultiBlockSelection(flatBlockOrder)) {
        clearSelection()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [hasMultiBlockSelection, flatBlockOrder, deleteSelectedBlocks, copySelectedBlocks, cutSelectedBlocks, clearSelection])

  // Navigate to previous block (arrow up at start)
  const handleNavigateUp = useCallback(
    (uuid: string, cursorOffset?: number) => {
      const flatBlocks = getFlattenedBlocks()
      const currentIndex = flatBlocks.findIndex((b) => b.uuid === uuid)
      if (currentIndex <= 0) return

      const previousBlock = flatBlocks[currentIndex - 1]
      // If cursor offset provided, try to maintain it; otherwise go to end
      focusBlock(previousBlock.uuid, cursorOffset !== undefined ? cursorOffset : 'end')
    },
    [getFlattenedBlocks, focusBlock]
  )

  // Navigate to next block (arrow down at end)
  const handleNavigateDown = useCallback(
    (uuid: string, cursorOffset?: number) => {
      const flatBlocks = getFlattenedBlocks()
      const currentIndex = flatBlocks.findIndex((b) => b.uuid === uuid)
      if (currentIndex === -1 || currentIndex >= flatBlocks.length - 1) return

      const nextBlock = flatBlocks[currentIndex + 1]
      // If cursor offset provided, try to maintain it; otherwise go to start
      focusBlock(nextBlock.uuid, cursorOffset !== undefined ? cursorOffset : 'start')
    },
    [getFlattenedBlocks, focusBlock]
  )

  // Move block up in document order
  // Rules:
  // 1. If block has a previous sibling, swap with it (simple case)
  // 2. If block is first child, become sibling before parent (outdent + move before)
  const handleMoveBlockUp = useCallback(
    (uuid: string) => {
      const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
      const block = blocks.find((b) => b.uuid === uuid)
      if (!block) return

      // Get siblings list
      const siblings = block.parentUuid
        ? blocks.find((b) => b.uuid === block.parentUuid)?.children || []
        : page.rootBlocks

      const currentIndex = siblings.indexOf(uuid)

      if (currentIndex > 0) {
        // Has previous sibling - swap with it
        if (block.parentUuid) {
          const parent = blocks.find((b) => b.uuid === block.parentUuid)
          if (!parent) return
          const newChildren = [...parent.children]
          ;[newChildren[currentIndex - 1], newChildren[currentIndex]] = [newChildren[currentIndex], newChildren[currentIndex - 1]]
          parent.children = newChildren
          updateCurrentPage(blocks)
        } else {
          // Root block
          const newRootBlocks = [...page.rootBlocks]
          ;[newRootBlocks[currentIndex - 1], newRootBlocks[currentIndex]] = [newRootBlocks[currentIndex], newRootBlocks[currentIndex - 1]]
          usePageStore.setState((state) => {
            if (state.currentPage) {
              state.currentPage.rootBlocks = newRootBlocks
            }
          })
          updateCurrentPage(blocks)
        }
      } else if (block.parentUuid) {
        // First child - move to become sibling before parent
        const parent = blocks.find((b) => b.uuid === block.parentUuid)
        if (!parent) return

        // Remove from parent's children
        parent.children = parent.children.filter((id) => id !== uuid)

        // Get grandparent's children list (or rootBlocks)
        if (parent.parentUuid) {
          const grandparent = blocks.find((b) => b.uuid === parent.parentUuid)
          if (!grandparent) return
          const parentIndex = grandparent.children.indexOf(parent.uuid)
          grandparent.children = [
            ...grandparent.children.slice(0, parentIndex),
            uuid,
            ...grandparent.children.slice(parentIndex),
          ]
          block.parentUuid = parent.parentUuid
          block.depth = parent.depth
        } else {
          // Parent is root - insert block before parent in rootBlocks
          const parentIndex = page.rootBlocks.indexOf(parent.uuid)
          const newRootBlocks = [
            ...page.rootBlocks.slice(0, parentIndex),
            uuid,
            ...page.rootBlocks.slice(parentIndex),
          ]
          block.parentUuid = null
          block.depth = 0
          usePageStore.setState((state) => {
            if (state.currentPage) {
              state.currentPage.rootBlocks = newRootBlocks
            }
          })
        }

        // Update depths of moved block's children
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

        updateCurrentPage(blocks)
      }
      // else: first root block, can't move up

      focusBlock(uuid, 'start')
    },
    [getAllBlocks, page.rootBlocks, updateCurrentPage, focusBlock]
  )

  // Move block down in document order
  // Rules:
  // 1. If block has a next sibling, swap with it (simple case)
  // 2. If block is last child, become sibling after parent (outdent + move after)
  const handleMoveBlockDown = useCallback(
    (uuid: string) => {
      const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
      const block = blocks.find((b) => b.uuid === uuid)
      if (!block) return

      // Get siblings list
      const siblings = block.parentUuid
        ? blocks.find((b) => b.uuid === block.parentUuid)?.children || []
        : page.rootBlocks

      const currentIndex = siblings.indexOf(uuid)

      if (currentIndex < siblings.length - 1) {
        // Has next sibling - swap with it
        if (block.parentUuid) {
          const parent = blocks.find((b) => b.uuid === block.parentUuid)
          if (!parent) return
          const newChildren = [...parent.children]
          ;[newChildren[currentIndex], newChildren[currentIndex + 1]] = [newChildren[currentIndex + 1], newChildren[currentIndex]]
          parent.children = newChildren
          updateCurrentPage(blocks)
        } else {
          // Root block
          const newRootBlocks = [...page.rootBlocks]
          ;[newRootBlocks[currentIndex], newRootBlocks[currentIndex + 1]] = [newRootBlocks[currentIndex + 1], newRootBlocks[currentIndex]]
          usePageStore.setState((state) => {
            if (state.currentPage) {
              state.currentPage.rootBlocks = newRootBlocks
            }
          })
          updateCurrentPage(blocks)
        }
      } else if (block.parentUuid) {
        // Last child - move to become sibling after parent
        const parent = blocks.find((b) => b.uuid === block.parentUuid)
        if (!parent) return

        // Remove from parent's children
        parent.children = parent.children.filter((id) => id !== uuid)

        // Get grandparent's children list (or rootBlocks)
        if (parent.parentUuid) {
          const grandparent = blocks.find((b) => b.uuid === parent.parentUuid)
          if (!grandparent) return
          const parentIndex = grandparent.children.indexOf(parent.uuid)
          grandparent.children = [
            ...grandparent.children.slice(0, parentIndex + 1),
            uuid,
            ...grandparent.children.slice(parentIndex + 1),
          ]
          block.parentUuid = parent.parentUuid
          block.depth = parent.depth
        } else {
          // Parent is root - insert block after parent in rootBlocks
          const parentIndex = page.rootBlocks.indexOf(parent.uuid)
          const newRootBlocks = [
            ...page.rootBlocks.slice(0, parentIndex + 1),
            uuid,
            ...page.rootBlocks.slice(parentIndex + 1),
          ]
          block.parentUuid = null
          block.depth = 0
          usePageStore.setState((state) => {
            if (state.currentPage) {
              state.currentPage.rootBlocks = newRootBlocks
            }
          })
        }

        // Update depths of moved block's children
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

        updateCurrentPage(blocks)
      }
      // else: last root block, can't move down

      focusBlock(uuid, 'start')
    },
    [getAllBlocks, page.rootBlocks, updateCurrentPage, focusBlock]
  )

  // Merge with previous block (backspace at start)
  const handleMergeWithPrevious = useCallback(
    (uuid: string) => {
      // Deep clone blocks to avoid mutating frozen Zustand state
      const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
      const flatBlocks = getFlattenedBlocks()
      const currentIndex = flatBlocks.findIndex((b) => b.uuid === uuid)

      // Block not found in flatBlocks - might be empty page state
      if (currentIndex === -1) {
        const blockInArray = blocks.find((b) => b.uuid === uuid)
        if (!blockInArray) return
        return
      }

      // Can't merge if first block - nothing to merge into
      if (currentIndex === 0) return

      const currentBlock = flatBlocks[currentIndex]
      const previousBlock = flatBlocks[currentIndex - 1]

      // Find blocks in our mutable array
      const prevBlockInArray = blocks.find((b) => b.uuid === previousBlock.uuid)
      const currentBlockInArray = blocks.find((b) => b.uuid === currentBlock.uuid)

      if (!prevBlockInArray || !currentBlockInArray) return

      // Calculate cursor position BEFORE modifying content
      const cursorPos = prevBlockInArray.content.length

      // Append current content to previous block
      prevBlockInArray.content = prevBlockInArray.content + currentBlockInArray.content

      // Remove current block from parent's children
      if (currentBlockInArray.parentUuid) {
        const parent = blocks.find((b) => b.uuid === currentBlockInArray.parentUuid)
        if (parent) {
          parent.children = parent.children.filter((id) => id !== uuid)
        }
      }

      // Move current block's children to previous block
      if (currentBlockInArray.children.length > 0) {
        for (const childUuid of currentBlockInArray.children) {
          const child = blocks.find((b) => b.uuid === childUuid)
          if (child) {
            child.parentUuid = previousBlock.uuid
          }
        }
        prevBlockInArray.children = [...prevBlockInArray.children, ...currentBlockInArray.children]
      }

      // Remove the current block
      const updatedBlocks = blocks.filter((b) => b.uuid !== uuid)
      updateCurrentPage(updatedBlocks)

      // Focus previous block at the merge point
      requestAnimationFrame(() => {
        const blockEl = document.querySelector(`[data-block-id="${previousBlock.uuid}"]`)
        const editorEl = blockEl?.querySelector('[contenteditable]') as HTMLElement
        if (!editorEl) return

        editorEl.focus()

        const selection = window.getSelection()
        if (!selection) return

        const range = document.createRange()
        if (editorEl.firstChild && editorEl.firstChild.nodeType === Node.TEXT_NODE) {
          const pos = Math.max(0, Math.min(cursorPos, editorEl.firstChild.textContent?.length || 0))
          range.setStart(editorEl.firstChild, pos)
          range.setEnd(editorEl.firstChild, pos)
        } else {
          range.selectNodeContents(editorEl)
          range.collapse(false)
        }
        selection.removeAllRanges()
        selection.addRange(range)
      })
    },
    [getAllBlocks, getFlattenedBlocks, updateCurrentPage]
  )

  // Render blocks recursively
  const renderBlock = (block: Block) => {
    const children = block.children
      .map((childUuid) => page.blocks[childUuid])
      .filter(Boolean)

    return (
      <BlockComponent
        key={block.uuid}
        block={block}
        onChange={handleBlockChange}
        onCreateBlock={handleCreateBlock}
        onDeleteBlock={handleDeleteBlock}
        onIndent={handleIndent}
        onOutdent={handleOutdent}
        onToggleCollapse={handleToggleCollapse}
        onMergeWithPrevious={handleMergeWithPrevious}
        onNavigateUp={handleNavigateUp}
        onNavigateDown={handleNavigateDown}
        onMoveBlockUp={handleMoveBlockUp}
        onMoveBlockDown={handleMoveBlockDown}
        onPasteBlocks={pasteBlocks}
        flatBlockOrder={flatBlockOrder}
      >
        {!block.collapsed &&
          children.map((child) => renderBlock(child))}
      </BlockComponent>
    )
  }

  // If page is empty, create and persist an initial empty block
  useEffect(() => {
    if (rootBlocks.length === 0) {
      const initialBlock: Block = {
        uuid: uuidv4(),
        content: '',
        parentUuid: null,
        children: [],
        collapsed: false,
        properties: {},
        depth: 0,
      }
      // Persist the initial block so Enter/other operations work
      updateCurrentPage([initialBlock])
    }
  }, [rootBlocks.length, updateCurrentPage])

  // While waiting for the initial block to be created, show a loading state
  if (rootBlocks.length === 0) {
    return (
      <div className="outliner-editor max-w-3xl">
        <div className="text-base-03 text-sm">Loading...</div>
      </div>
    )
  }

  return (
    <LayoutGroup>
      <div className="outliner-editor max-w-3xl">
        {rootBlocks.map((block) => renderBlock(block))}
      </div>
    </LayoutGroup>
  )
}
