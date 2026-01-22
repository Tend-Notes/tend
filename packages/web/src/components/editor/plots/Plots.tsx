// SPDX-License-Identifier: MIT WITH Commons-Clause
// Plots: Outline container component
//
// Manages the block tree structure and provides operations to Seeds via callbacks.
// Drop-in replacement for OutlinerEditor - same props interface.

import { useCallback, useMemo, useEffect } from 'react'
import type { Page, Block } from '../../../types'
import { usePageStore } from '../../../stores/pageStore'
import { useSelectionStore } from '../../../stores/selectionStore'
import { Seed } from './Seed'
import { v4 as uuidv4 } from 'uuid'

interface PlotsProps {
  page: Page
  readonly?: boolean
}

export function Plots({ page, readonly = false }: PlotsProps) {
  const updateCurrentPage = usePageStore((state) => state.updateCurrentPage)
  const { getSelectedUuids, hasMultiBlockSelection, clearSelection, setFocusedBlock } = useSelectionStore()

  // Get root blocks for rendering
  const rootBlocks = useMemo(() => {
    return page.rootBlocks
      .map((uuid) => page.blocks[uuid])
      .filter(Boolean)
  }, [page.rootBlocks, page.blocks])

  // Convert blocks object to array for saving
  const getAllBlocks = useCallback((): Block[] => {
    return Object.values(page.blocks)
  }, [page.blocks])

  // Flattened block order for navigation and selection
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

  // ─────────────────────────────────────────────────────────────────────────
  // TREE OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────

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
  const handleCreateBlock = useCallback(
    (afterUuid: string, contentForNewBlock?: string): string | undefined => {
      const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
      const afterBlock = blocks.find((b) => b.uuid === afterUuid)
      if (!afterBlock) return undefined

      // If current block has visible children, new block becomes first child
      const hasVisibleChildren = afterBlock.children.length > 0 && !afterBlock.collapsed

      const newBlock: Block = {
        uuid: uuidv4(),
        content: contentForNewBlock || '',
        parentUuid: hasVisibleChildren ? afterUuid : afterBlock.parentUuid,
        children: [],
        collapsed: false,
        properties: {},
        depth: hasVisibleChildren ? afterBlock.depth + 1 : afterBlock.depth,
      }

      if (hasVisibleChildren) {
        // Insert as first child
        afterBlock.children = [newBlock.uuid, ...afterBlock.children]
        updateCurrentPage([...blocks, newBlock])
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
        updateCurrentPage([...blocks, newBlock])
      } else {
        // Root-level: update rootBlocks
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

  // Delete a block
  const handleDeleteBlock = useCallback(
    (uuid: string) => {
      const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
      if (blocks.length <= 1) return

      const blockToDelete = blocks.find((b) => b.uuid === uuid)
      if (!blockToDelete) return

      // Remove from parent's children
      if (blockToDelete.parentUuid) {
        const parent = blocks.find((b) => b.uuid === blockToDelete.parentUuid)
        if (parent) {
          parent.children = parent.children.filter((id) => id !== uuid)
        }
      }

      const updatedBlocks = blocks.filter((b) => b.uuid !== uuid)
      updateCurrentPage(updatedBlocks)
    },
    [getAllBlocks, updateCurrentPage]
  )

  // Indent a block (make it child of previous sibling)
  const handleIndent = useCallback(
    (uuid: string) => {
      const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
      const block = blocks.find((b) => b.uuid === uuid)
      if (!block) return

      const siblings = block.parentUuid
        ? blocks.find((b) => b.uuid === block.parentUuid)?.children || []
        : page.rootBlocks

      const currentIndex = siblings.indexOf(uuid)
      if (currentIndex <= 0) return // Can't indent if first

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
      focusBlock(uuid, 'start')
    },
    [getAllBlocks, page.rootBlocks, updateCurrentPage]
  )

  // Outdent a block (move to parent's level)
  const handleOutdent = useCallback(
    (uuid: string) => {
      const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
      const block = blocks.find((b) => b.uuid === uuid)
      if (!block || !block.parentUuid) return // Can't outdent root

      const parent = blocks.find((b) => b.uuid === block.parentUuid)
      if (!parent) return

      // Remove from parent
      parent.children = parent.children.filter((id) => id !== uuid)

      // Update parent reference
      const newParentUuid = parent.parentUuid
      block.parentUuid = newParentUuid
      block.depth = Math.max(0, block.depth - 1)

      // Insert after parent in grandparent's children
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
      focusBlock(uuid, 'start')
    },
    [getAllBlocks, updateCurrentPage]
  )

  // Toggle collapsed state
  const handleToggleCollapse = useCallback(
    (uuid: string) => {
      const blocks = getAllBlocks().map((b) =>
        b.uuid === uuid ? { ...b, collapsed: !b.collapsed } : b
      )
      updateCurrentPage(blocks)
    },
    [getAllBlocks, updateCurrentPage]
  )

  // Merge with previous block (backspace at start)
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
      updateCurrentPage(updatedBlocks)

      focusBlock(previousUuid, cursorPos)
    },
    [getAllBlocks, flatBlockOrder, updateCurrentPage]
  )

  // Navigate to previous block
  const handleNavigateUp = useCallback(
    (uuid: string, cursorOffset?: number) => {
      const currentIndex = flatBlockOrder.indexOf(uuid)
      if (currentIndex <= 0) return

      const previousUuid = flatBlockOrder[currentIndex - 1]
      focusBlock(previousUuid, cursorOffset !== undefined ? cursorOffset : 'end')
    },
    [flatBlockOrder]
  )

  // Navigate to next block
  const handleNavigateDown = useCallback(
    (uuid: string, cursorOffset?: number) => {
      const currentIndex = flatBlockOrder.indexOf(uuid)
      if (currentIndex === -1 || currentIndex >= flatBlockOrder.length - 1) return

      const nextUuid = flatBlockOrder[currentIndex + 1]
      focusBlock(nextUuid, cursorOffset !== undefined ? cursorOffset : 'start')
    },
    [flatBlockOrder]
  )

  // Move block up
  const handleMoveBlockUp = useCallback(
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
          ;[newChildren[currentIndex - 1], newChildren[currentIndex]] = [newChildren[currentIndex], newChildren[currentIndex - 1]]
          parent.children = newChildren
          updateCurrentPage(blocks)
        } else {
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
        // First child - move before parent
        const parent = blocks.find((b) => b.uuid === block.parentUuid)
        if (!parent) return

        parent.children = parent.children.filter((id) => id !== uuid)

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

        // Update child depths
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

      focusBlock(uuid, 'start')
    },
    [getAllBlocks, page.rootBlocks, updateCurrentPage]
  )

  // Move block down
  const handleMoveBlockDown = useCallback(
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
          ;[newChildren[currentIndex], newChildren[currentIndex + 1]] = [newChildren[currentIndex + 1], newChildren[currentIndex]]
          parent.children = newChildren
          updateCurrentPage(blocks)
        } else {
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
        // Last child - move after parent
        const parent = blocks.find((b) => b.uuid === block.parentUuid)
        if (!parent) return

        parent.children = parent.children.filter((id) => id !== uuid)

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

        // Update child depths
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

      focusBlock(uuid, 'start')
    },
    [getAllBlocks, page.rootBlocks, updateCurrentPage]
  )

  // Paste blocks from clipboard
  const handlePasteBlocks = useCallback(
    async (afterUuid: string) => {
      const text = await navigator.clipboard.readText()
      if (!text) return

      const lines = text.split('\n').filter((line) => line.trim())
      if (lines.length === 0) return

      const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
      const afterBlock = blocks.find((b) => b.uuid === afterUuid)
      if (!afterBlock) return

      // Parse lines into blocks
      interface ParsedLine {
        content: string
        indent: number
      }

      const parsedLines: ParsedLine[] = lines.map((line) => {
        const match = line.match(/^(\s*)(?:-\s*)?(.*)$/)
        if (match) {
          const spaces = match[1]
          const content = match[2]
          const indent = Math.floor(spaces.length / 2)
          return { content, indent }
        }
        return { content: line.trim(), indent: 0 }
      })

      const newBlocks: Block[] = []
      const uuidStack: { uuid: string; indent: number }[] = []
      const baseIndent = Math.min(...parsedLines.map((l) => l.indent))

      for (const { content, indent } of parsedLines) {
        const relativeIndent = indent - baseIndent

        while (uuidStack.length > 0 && uuidStack[uuidStack.length - 1].indent >= relativeIndent) {
          uuidStack.pop()
        }

        const parentUuid = uuidStack.length > 0 ? uuidStack[uuidStack.length - 1].uuid : null
        const parentBlock = parentUuid
          ? blocks.find((b) => b.uuid === parentUuid) || newBlocks.find((b) => b.uuid === parentUuid)
          : null

        const newBlock: Block = {
          uuid: uuidv4(),
          content,
          parentUuid,
          children: [],
          collapsed: false,
          properties: {},
          depth: parentBlock ? parentBlock.depth + 1 : afterBlock.depth,
        }

        if (parentBlock) {
          parentBlock.children.push(newBlock.uuid)
        }

        newBlocks.push(newBlock)
        uuidStack.push({ uuid: newBlock.uuid, indent: relativeIndent })
      }

      // Insert pasted root blocks after afterBlock
      const pastedRootUuids = newBlocks.filter((b) => !b.parentUuid).map((b) => b.uuid)

      if (afterBlock.parentUuid) {
        const parent = blocks.find((b) => b.uuid === afterBlock.parentUuid)
        if (parent) {
          const afterIndex = parent.children.indexOf(afterUuid)
          parent.children = [
            ...parent.children.slice(0, afterIndex + 1),
            ...pastedRootUuids,
            ...parent.children.slice(afterIndex + 1),
          ]
          for (const uuid of pastedRootUuids) {
            const pastedBlock = newBlocks.find((b) => b.uuid === uuid)
            if (pastedBlock) {
              pastedBlock.parentUuid = afterBlock.parentUuid
              pastedBlock.depth = afterBlock.depth
            }
          }
        }
      }

      updateCurrentPage([...blocks, ...newBlocks])

      if (newBlocks.length > 0) {
        focusBlock(newBlocks[newBlocks.length - 1].uuid, 'end')
      }
    },
    [getAllBlocks, updateCurrentPage]
  )

  // ─────────────────────────────────────────────────────────────────────────
  // MULTI-BLOCK SELECTION
  // ─────────────────────────────────────────────────────────────────────────

  const deleteSelectedBlocks = useCallback(() => {
    const selectedUuids = getSelectedUuids(flatBlockOrder)
    if (selectedUuids.length === 0) return

    let blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))

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

    for (const uuid of selectedUuids) {
      const block = blocks.find((b) => b.uuid === uuid)
      if (block?.parentUuid) {
        const parent = blocks.find((b) => b.uuid === block.parentUuid)
        if (parent) {
          parent.children = parent.children.filter((id) => id !== uuid)
        }
      }
    }

    const selectedSet = new Set(selectedUuids)
    blocks = blocks.filter((b) => !selectedSet.has(b.uuid))

    updateCurrentPage(blocks)
    clearSelection()

    const firstSelectedIndex = flatBlockOrder.indexOf(selectedUuids[0])
    const blockBeforeUuid = firstSelectedIndex > 0 ? flatBlockOrder[firstSelectedIndex - 1] : null
    const blockAfterUuid = flatBlockOrder[flatBlockOrder.indexOf(selectedUuids[selectedUuids.length - 1]) + 1]

    if (blockBeforeUuid && !selectedSet.has(blockBeforeUuid)) {
      focusBlock(blockBeforeUuid, 'end')
    } else if (blockAfterUuid && !selectedSet.has(blockAfterUuid)) {
      focusBlock(blockAfterUuid, 'start')
    }
  }, [getSelectedUuids, flatBlockOrder, getAllBlocks, updateCurrentPage, clearSelection])

  const blocksToMarkdown = useCallback((blockUuids: string[]): string => {
    const lines: string[] = []

    const serializeBlock = (uuid: string, indent: number) => {
      const block = page.blocks[uuid]
      if (!block) return

      const prefix = '  '.repeat(indent) + '- '
      lines.push(prefix + block.content)

      for (const childUuid of block.children) {
        serializeBlock(childUuid, indent + 1)
      }
    }

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

  const copySelectedBlocks = useCallback(async () => {
    const selectedUuids = getSelectedUuids(flatBlockOrder)
    if (selectedUuids.length === 0) return

    const markdown = blocksToMarkdown(selectedUuids)
    await navigator.clipboard.writeText(markdown)
  }, [getSelectedUuids, flatBlockOrder, blocksToMarkdown])

  const cutSelectedBlocks = useCallback(async () => {
    await copySelectedBlocks()
    deleteSelectedBlocks()
  }, [copySelectedBlocks, deleteSelectedBlocks])

  // End drag selection on mouseup
  const endDrag = useSelectionStore((state) => state.endDrag)

  useEffect(() => {
    const handleMouseUp = () => endDrag()
    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [endDrag])

  // Keyboard shortcuts for selection operations
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      if ((e.key === 'Delete' || e.key === 'Backspace') && hasMultiBlockSelection(flatBlockOrder)) {
        e.preventDefault()
        deleteSelectedBlocks()
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && hasMultiBlockSelection(flatBlockOrder)) {
        e.preventDefault()
        copySelectedBlocks()
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'x' && hasMultiBlockSelection(flatBlockOrder)) {
        e.preventDefault()
        cutSelectedBlocks()
        return
      }

      if (e.key === 'Escape' && hasMultiBlockSelection(flatBlockOrder)) {
        clearSelection()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [hasMultiBlockSelection, flatBlockOrder, deleteSelectedBlocks, copySelectedBlocks, cutSelectedBlocks, clearSelection])

  // ─────────────────────────────────────────────────────────────────────────
  // FOCUS HELPER
  // ─────────────────────────────────────────────────────────────────────────

  const focusBlock = useCallback((blockUuid: string, position: 'start' | 'end' | number) => {
    setFocusedBlock(blockUuid)
    requestAnimationFrame(() => {
      const blockEl = document.querySelector(`[data-block-id="${blockUuid}"]`)
      const editorEl = blockEl?.querySelector('[data-seed-editor]') as HTMLElement
      if (!editorEl) return

      editorEl.focus()

      // Position cursor - Seeds will handle this via their own API
      const event = new CustomEvent('seed-focus', {
        detail: { position },
        bubbles: false,
      })
      editorEl.dispatchEvent(event)
    })
  }, [setFocusedBlock])

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  const renderBlock = (block: Block) => {
    const children = block.children
      .map((childUuid) => page.blocks[childUuid])
      .filter(Boolean)

    return (
      <Seed
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
        onPasteBlocks={handlePasteBlocks}
        flatBlockOrder={flatBlockOrder}
        readonly={readonly}
      >
        {!block.collapsed && children.map((child) => renderBlock(child))}
      </Seed>
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

  if (rootBlocks.length === 0) {
    return (
      <div className="outliner-editor max-w-3xl">
        <div className="text-base-03 text-sm">Loading...</div>
      </div>
    )
  }

  return (
    <div className="outliner-editor max-w-3xl">
      {rootBlocks.map((block) => renderBlock(block))}
    </div>
  )
}

// Re-export as OutlinerEditor for drop-in compatibility
export { Plots as OutlinerEditor }
