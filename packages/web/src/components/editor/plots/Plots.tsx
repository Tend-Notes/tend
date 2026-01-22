// SPDX-License-Identifier: MIT WITH Commons-Clause
// Plots: Outline container component
//
// Manages the block tree structure. Owns selection state and keyboard navigation.
// Drop-in replacement for OutlinerEditor - same props interface.
//
// TEST VERSION: Static placeholder blocks with keyboard-driven tree operations.

import { useMemo, useEffect, useCallback, useState, useRef, KeyboardEvent } from 'react'
import type { Page, Block } from '../../../types'
import { usePageStore } from '../../../stores/pageStore'
import { v4 as uuidv4 } from 'uuid'

interface PlotsProps {
  page: Page
  readonly?: boolean
}

export function Plots({ page }: PlotsProps) {
  const updateCurrentPage = usePageStore((state) => state.updateCurrentPage)
  const containerRef = useRef<HTMLDivElement>(null)
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null)

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

  // Convert blocks object to array for saving
  const getAllBlocks = useCallback((): Block[] => {
    return Object.values(page.blocks)
  }, [page.blocks])

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

  const handleCreateBlock = useCallback(
    (afterUuid: string): string => {
      const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
      const afterBlock = blocks.find((b) => b.uuid === afterUuid)
      if (!afterBlock) return afterUuid

      const hasVisibleChildren = afterBlock.children.length > 0 && !afterBlock.collapsed

      const newBlock: Block = {
        uuid: uuidv4(),
        content: '',
        parentUuid: hasVisibleChildren ? afterUuid : afterBlock.parentUuid,
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
          const afterIndex = parent.children.indexOf(afterUuid)
          parent.children = [
            ...parent.children.slice(0, afterIndex + 1),
            newBlock.uuid,
            ...parent.children.slice(afterIndex + 1),
          ]
        }
        updateCurrentPage([...blocks, newBlock])
      } else {
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

  const handleDeleteBlock = useCallback(
    (uuid: string): string | null => {
      const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
      if (blocks.length <= 1) return uuid

      const currentIndex = flatBlockOrder.indexOf(uuid)
      const blockToDelete = blocks.find((b) => b.uuid === uuid)
      if (!blockToDelete) return uuid

      // Remove from parent's children
      if (blockToDelete.parentUuid) {
        const parent = blocks.find((b) => b.uuid === blockToDelete.parentUuid)
        if (parent) {
          parent.children = parent.children.filter((id) => id !== uuid)
        }
      } else {
        // Remove from rootBlocks
        const newRootBlocks = page.rootBlocks.filter((id) => id !== uuid)
        usePageStore.setState((state) => {
          if (state.currentPage) {
            state.currentPage.rootBlocks = newRootBlocks
          }
        })
      }

      const updatedBlocks = blocks.filter((b) => b.uuid !== uuid)
      updateCurrentPage(updatedBlocks)

      // Return previous block or next block
      if (currentIndex > 0) {
        return flatBlockOrder[currentIndex - 1]
      } else if (flatBlockOrder.length > 1) {
        return flatBlockOrder[1]
      }
      return null
    },
    [getAllBlocks, updateCurrentPage, flatBlockOrder, page.rootBlocks]
  )

  const handleIndent = useCallback(
    (uuid: string) => {
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
      } else {
        const newRootBlocks = page.rootBlocks.filter((id) => id !== uuid)
        usePageStore.setState((state) => {
          if (state.currentPage) {
            state.currentPage.rootBlocks = newRootBlocks
          }
        })
      }

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

      updateCurrentPage(blocks)
    },
    [getAllBlocks, page.rootBlocks, updateCurrentPage]
  )

  const handleOutdent = useCallback(
    (uuid: string) => {
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
        const parentIndex = page.rootBlocks.indexOf(parent.uuid)
        const newRootBlocks = [
          ...page.rootBlocks.slice(0, parentIndex + 1),
          uuid,
          ...page.rootBlocks.slice(parentIndex + 1),
        ]
        usePageStore.setState((state) => {
          if (state.currentPage) {
            state.currentPage.rootBlocks = newRootBlocks
          }
        })
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

      updateCurrentPage(blocks)
    },
    [getAllBlocks, updateCurrentPage, page.rootBlocks]
  )

  const handleMoveUp = useCallback(
    (uuid: string) => {
      const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
      const block = blocks.find((b) => b.uuid === uuid)
      if (!block) return

      const siblings = block.parentUuid
        ? blocks.find((b) => b.uuid === block.parentUuid)?.children || []
        : page.rootBlocks

      const currentIndex = siblings.indexOf(uuid)

      if (currentIndex > 0) {
        // Swap with previous sibling
        if (block.parentUuid) {
          const parent = blocks.find((b) => b.uuid === block.parentUuid)
          if (!parent) return
          const newChildren = [...parent.children]
          ;[newChildren[currentIndex - 1], newChildren[currentIndex]] =
            [newChildren[currentIndex], newChildren[currentIndex - 1]]
          parent.children = newChildren
          updateCurrentPage(blocks)
        } else {
          const newRootBlocks = [...page.rootBlocks]
          ;[newRootBlocks[currentIndex - 1], newRootBlocks[currentIndex]] =
            [newRootBlocks[currentIndex], newRootBlocks[currentIndex - 1]]
          usePageStore.setState((state) => {
            if (state.currentPage) {
              state.currentPage.rootBlocks = newRootBlocks
            }
          })
          updateCurrentPage(blocks)
        }
      }
    },
    [getAllBlocks, page.rootBlocks, updateCurrentPage]
  )

  const handleMoveDown = useCallback(
    (uuid: string) => {
      const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
      const block = blocks.find((b) => b.uuid === uuid)
      if (!block) return

      const siblings = block.parentUuid
        ? blocks.find((b) => b.uuid === block.parentUuid)?.children || []
        : page.rootBlocks

      const currentIndex = siblings.indexOf(uuid)

      if (currentIndex < siblings.length - 1) {
        // Swap with next sibling
        if (block.parentUuid) {
          const parent = blocks.find((b) => b.uuid === block.parentUuid)
          if (!parent) return
          const newChildren = [...parent.children]
          ;[newChildren[currentIndex], newChildren[currentIndex + 1]] =
            [newChildren[currentIndex + 1], newChildren[currentIndex]]
          parent.children = newChildren
          updateCurrentPage(blocks)
        } else {
          const newRootBlocks = [...page.rootBlocks]
          ;[newRootBlocks[currentIndex], newRootBlocks[currentIndex + 1]] =
            [newRootBlocks[currentIndex + 1], newRootBlocks[currentIndex]]
          usePageStore.setState((state) => {
            if (state.currentPage) {
              state.currentPage.rootBlocks = newRootBlocks
            }
          })
          updateCurrentPage(blocks)
        }
      }
    },
    [getAllBlocks, page.rootBlocks, updateCurrentPage]
  )

  // ─────────────────────────────────────────────────────────────────────────
  // NAVIGATION
  // ─────────────────────────────────────────────────────────────────────────

  const navigateUp = useCallback(() => {
    if (!selectedUuid) {
      if (flatBlockOrder.length > 0) {
        setSelectedUuid(flatBlockOrder[0])
      }
      return
    }
    const currentIndex = flatBlockOrder.indexOf(selectedUuid)
    if (currentIndex > 0) {
      setSelectedUuid(flatBlockOrder[currentIndex - 1])
    }
  }, [selectedUuid, flatBlockOrder])

  const navigateDown = useCallback(() => {
    if (!selectedUuid) {
      if (flatBlockOrder.length > 0) {
        setSelectedUuid(flatBlockOrder[0])
      }
      return
    }
    const currentIndex = flatBlockOrder.indexOf(selectedUuid)
    if (currentIndex < flatBlockOrder.length - 1) {
      setSelectedUuid(flatBlockOrder[currentIndex + 1])
    }
  }, [selectedUuid, flatBlockOrder])

  // ─────────────────────────────────────────────────────────────────────────
  // KEYBOARD HANDLER
  // ─────────────────────────────────────────────────────────────────────────

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (!selectedUuid) {
      // Any key selects first block
      if (flatBlockOrder.length > 0) {
        setSelectedUuid(flatBlockOrder[0])
      }
      return
    }

    // Arrow Up - navigate
    if (e.key === 'ArrowUp' && !e.altKey) {
      e.preventDefault()
      navigateUp()
      return
    }

    // Arrow Down - navigate
    if (e.key === 'ArrowDown' && !e.altKey) {
      e.preventDefault()
      navigateDown()
      return
    }

    // Alt+Arrow Up - move block up
    if (e.key === 'ArrowUp' && e.altKey) {
      e.preventDefault()
      handleMoveUp(selectedUuid)
      return
    }

    // Alt+Arrow Down - move block down
    if (e.key === 'ArrowDown' && e.altKey) {
      e.preventDefault()
      handleMoveDown(selectedUuid)
      return
    }

    // Tab - indent
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault()
      handleIndent(selectedUuid)
      return
    }

    // Shift+Tab - outdent
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      handleOutdent(selectedUuid)
      return
    }

    // Enter - create new block
    if (e.key === 'Enter') {
      e.preventDefault()
      const newUuid = handleCreateBlock(selectedUuid)
      setSelectedUuid(newUuid)
      return
    }

    // Backspace - delete empty block
    if (e.key === 'Backspace') {
      const block = page.blocks[selectedUuid]
      if (block && block.content === '') {
        e.preventDefault()
        const newSelection = handleDeleteBlock(selectedUuid)
        if (newSelection) {
          setSelectedUuid(newSelection)
        }
      }
      return
    }
  }, [
    selectedUuid,
    flatBlockOrder,
    page.blocks,
    navigateUp,
    navigateDown,
    handleMoveUp,
    handleMoveDown,
    handleIndent,
    handleOutdent,
    handleCreateBlock,
    handleDeleteBlock,
  ])

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  const renderBlock = (block: Block) => {
    const blockChildren = block.children
      .map((childUuid) => page.blocks[childUuid])
      .filter(Boolean)
    const hasChildren = block.children.length > 0
    const isSelected = block.uuid === selectedUuid

    return (
      <div
        key={block.uuid}
        className={`block-container bg-base-01/50 ${isSelected ? 'ring-2 ring-base-0D' : ''}`}
        data-block-id={block.uuid}
        onClick={() => setSelectedUuid(block.uuid)}
      >
        <div className="block flex items-start py-0.5">
          {/* Bullet */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (hasChildren) handleToggleCollapse(block.uuid)
            }}
            className={`bullet mt-[0.55rem] ${
              hasChildren ? (block.collapsed ? 'bullet--collapsed' : '') : ''
            }`}
          />

          {/* Placeholder content - static, no editing */}
          <div className="flex-1 min-h-[1.5em] text-base-05">
            {block.content || <span className="text-base-03 italic">empty</span>}
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

  // Create initial empty block if page is empty
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
      updateCurrentPage([initialBlock])
    }
  }, [rootBlocks.length, updateCurrentPage])

  // Auto-select first block
  useEffect(() => {
    if (!selectedUuid && flatBlockOrder.length > 0) {
      setSelectedUuid(flatBlockOrder[0])
    }
  }, [selectedUuid, flatBlockOrder])

  if (rootBlocks.length === 0) {
    return (
      <div className="outliner-editor max-w-3xl">
        <div className="text-base-03 text-sm">Loading...</div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="outliner-editor max-w-3xl focus:outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {rootBlocks.map((block) => renderBlock(block))}
    </div>
  )
}

// Re-export as OutlinerEditor for drop-in compatibility
export { Plots as OutlinerEditor }
