// SPDX-License-Identifier: MIT WITH Commons-Clause
// Main outliner editor component

import { useCallback, useMemo, useEffect } from 'react'
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
      } else if (afterBlock.parentUuid) {
        // Insert as sibling after current block
        const parent = blocks.find((b) => b.uuid === afterBlock.parentUuid)
        if (parent) {
          const afterIndex = parent.children.indexOf(afterUuid)
          parent.children = [
            ...parent.children.slice(0, afterIndex + 1),
            newBlock.uuid,
            ...parent.children.slice(afterIndex + 1),
          ]
        }
      }

      updateCurrentPage([...blocks, newBlock])
      return newBlock.uuid
    },
    [getAllBlocks, updateCurrentPage]
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

  // Handle Delete/Backspace key for multi-block deletion
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle Delete/Backspace when we have multi-block selection
      if ((e.key === 'Delete' || e.key === 'Backspace') && hasMultiBlockSelection(flatBlockOrder)) {
        // Don't interfere if user is typing in an input/textarea
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

        e.preventDefault()
        deleteSelectedBlocks()
      }

      // Escape clears selection
      if (e.key === 'Escape' && hasMultiBlockSelection(flatBlockOrder)) {
        clearSelection()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [hasMultiBlockSelection, flatBlockOrder, deleteSelectedBlocks, clearSelection])

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

  // Move block up: make it the last child of the previous visible block
  // (This is different from outdent - it moves the block in document order)
  const handleMoveBlockUp = useCallback(
    (uuid: string) => {
      const flatBlocks = getFlattenedBlocks()
      const currentIndex = flatBlocks.findIndex((b) => b.uuid === uuid)
      if (currentIndex <= 0) return // Can't move first block up

      // Deep clone blocks
      const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
      const block = blocks.find((b) => b.uuid === uuid)
      if (!block) return

      const previousBlock = flatBlocks[currentIndex - 1]
      const prevBlockInArray = blocks.find((b) => b.uuid === previousBlock.uuid)
      if (!prevBlockInArray) return

      // Remove block from current parent
      if (block.parentUuid) {
        const oldParent = blocks.find((b) => b.uuid === block.parentUuid)
        if (oldParent) {
          oldParent.children = oldParent.children.filter((id) => id !== uuid)
        }
      }

      // Add as last child of previous block
      prevBlockInArray.children = [...prevBlockInArray.children, uuid]
      block.parentUuid = previousBlock.uuid
      block.depth = prevBlockInArray.depth + 1

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
      focusBlock(uuid, 'start')
    },
    [getFlattenedBlocks, getAllBlocks, updateCurrentPage, focusBlock]
  )

  // Move block down: move after the next visible block (or after its last descendant)
  const handleMoveBlockDown = useCallback(
    (uuid: string) => {
      const flatBlocks = getFlattenedBlocks()
      const currentIndex = flatBlocks.findIndex((b) => b.uuid === uuid)
      if (currentIndex === -1 || currentIndex >= flatBlocks.length - 1) return // Can't move last block down

      // Deep clone blocks
      const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
      const block = blocks.find((b) => b.uuid === uuid)
      if (!block) return

      const nextBlock = flatBlocks[currentIndex + 1]
      const nextBlockInArray = blocks.find((b) => b.uuid === nextBlock.uuid)
      if (!nextBlockInArray) return

      // Remove block from current parent
      if (block.parentUuid) {
        const oldParent = blocks.find((b) => b.uuid === block.parentUuid)
        if (oldParent) {
          oldParent.children = oldParent.children.filter((id) => id !== uuid)
        }
      }

      // Find where to insert: after the next block's subtree
      // If next block has visible children, we go after its last visible descendant
      // This means we become a sibling of next block (inserted after it in parent's children)

      // Find the last visible descendant of nextBlock
      let targetBlock = nextBlockInArray

      // Walk through flatBlocks to find the last descendant of nextBlock
      // A block is a descendant if it has greater depth and comes before a block at same/lower depth
      for (let i = currentIndex + 2; i < flatBlocks.length; i++) {
        const candidate = flatBlocks[i]
        if (candidate.depth <= nextBlockInArray.depth) {
          break // Found a block at same or lower level, stop
        }
        targetBlock = blocks.find((b) => b.uuid === candidate.uuid) || targetBlock
      }

      // Now insert block as sibling right after targetBlock
      // The new parent is targetBlock's parent (same level)
      const newParentUuid = targetBlock.parentUuid
      block.parentUuid = newParentUuid

      if (newParentUuid) {
        const newParent = blocks.find((b) => b.uuid === newParentUuid)
        if (newParent) {
          const targetSiblingIndex = newParent.children.indexOf(targetBlock.uuid)
          newParent.children = [
            ...newParent.children.slice(0, targetSiblingIndex + 1),
            uuid,
            ...newParent.children.slice(targetSiblingIndex + 1),
          ]
        }
      }

      // Update depth (same level as target block)
      block.depth = targetBlock.depth

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
      focusBlock(uuid, 'start')
    },
    [getFlattenedBlocks, getAllBlocks, updateCurrentPage, focusBlock]
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
        flatBlockOrder={flatBlockOrder}
      >
        {!block.collapsed &&
          children.map((child) => renderBlock(child))}
      </BlockComponent>
    )
  }

  // If page is empty, show a single empty block
  if (rootBlocks.length === 0) {
    const emptyBlock: Block = {
      uuid: uuidv4(),
      content: '',
      parentUuid: null,
      children: [],
      collapsed: false,
      properties: {},
      depth: 0,
    }

    return (
      <div className="outliner-editor max-w-3xl">
        <BlockComponent
          block={emptyBlock}
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
          flatBlockOrder={[emptyBlock.uuid]}
        />
      </div>
    )
  }

  return (
    <div className="outliner-editor max-w-3xl">
      {rootBlocks.map((block) => renderBlock(block))}
    </div>
  )
}
