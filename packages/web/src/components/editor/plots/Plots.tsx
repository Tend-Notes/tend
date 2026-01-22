// SPDX-License-Identifier: MIT WITH Commons-Clause
// Plots: Outline container component
//
// Manages the block tree structure and provides operations to Seeds via callbacks.
// Drop-in replacement for OutlinerEditor - same props interface.
//
// PLACEHOLDER VERSION: Renders static blocks to validate tree structure.
// Tree operations are stubbed - will be connected when Seed is implemented.

import { useMemo, useEffect, useCallback } from 'react'
import type { Page, Block } from '../../../types'
import { usePageStore } from '../../../stores/pageStore'
import { v4 as uuidv4 } from 'uuid'

interface PlotsProps {
  page: Page
  readonly?: boolean
}

export function Plots({ page }: PlotsProps) {
  const updateCurrentPage = usePageStore((state) => state.updateCurrentPage)

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

  // Toggle collapsed state - the only operation needed for placeholder
  const handleToggleCollapse = useCallback(
    (uuid: string) => {
      const blocks = getAllBlocks().map((b) =>
        b.uuid === uuid ? { ...b, collapsed: !b.collapsed } : b
      )
      updateCurrentPage(blocks)
    },
    [getAllBlocks, updateCurrentPage]
  )

  // Render placeholder blocks
  const renderBlock = (block: Block) => {
    const blockChildren = block.children
      .map((childUuid) => page.blocks[childUuid])
      .filter(Boolean)
    const hasChildren = block.children.length > 0

    return (
      <div key={block.uuid} className="block-container bg-base-01/50" data-block-id={block.uuid}>
        <div className="block flex items-start py-0.5">
          {/* Bullet */}
          <button
            onClick={() => hasChildren && handleToggleCollapse(block.uuid)}
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
