// SPDX-License-Identifier: MIT WITH Commons-Clause
// Shared root-block recomputation for the editor's three update paths
// (current page, template, import error).
//
// Each of them turns a flat block list into {blockMap, rootBlocks}. The
// membership tests used to be `Array.includes` inside loops over every root,
// which is O(roots²) — and the page path runs on every debounced save, so a
// flat thousand-root journal paid ~10⁶ string comparisons per save. Sets make
// the same decisions in linear time.

import type { Block } from '../types'

export interface RootBlocksResult {
  blockMap: Record<string, Block>
  finalRoots: string[]
}

export interface ComputeRootBlocksOptions {
  /**
   * Blocks as they were *before* this update. When given, a block that has
   * just become a root is inserted after its former parent (if that parent is
   * itself a root) rather than appended — this is what keeps an outdented
   * block next to where it came from. Only the current-page path wants it.
   */
  previousBlocks?: Record<string, Block>
}

/**
 * Recompute the block map and root ordering after an editor update.
 *
 * `rootBlocksHint` is the editor's own ordering: it wins, filtered to blocks
 * that really are roots, with any roots it missed appended. Without a hint the
 * previous ordering is preserved and new roots are placed per the options.
 */
export function computeRootBlocks(
  blocks: Block[],
  rootBlocksHint: string[] | undefined,
  existingRoots: string[],
  opts: ComputeRootBlocksOptions = {}
): RootBlocksResult {
  const blockMap: Record<string, Block> = {}
  const newRootUuids = new Set<string>()

  for (const block of blocks) {
    blockMap[block.uuid] = block
    if (!block.parentUuid) {
      newRootUuids.add(block.uuid)
    }
  }

  let finalRoots: string[]

  if (rootBlocksHint) {
    finalRoots = rootBlocksHint.filter((uuid) => newRootUuids.has(uuid))
    const placed = new Set(finalRoots)
    for (const uuid of newRootUuids) {
      if (!placed.has(uuid)) {
        finalRoots.push(uuid)
        placed.add(uuid)
      }
    }
    return { blockMap, finalRoots }
  }

  const existingSet = new Set(existingRoots)
  finalRoots = existingRoots.filter((uuid) => newRootUuids.has(uuid))
  const addedRoots = [...newRootUuids].filter((uuid) => !existingSet.has(uuid))

  if (!opts.previousBlocks) {
    return { blockMap, finalRoots: [...finalRoots, ...addedRoots] }
  }

  // Insert each newly promoted root after its former parent when that parent
  // is a root here; the list is mutated as we go, so a run of siblings keeps
  // its relative order.
  for (const newRootUuid of addedRoots) {
    const formerParentUuid = opts.previousBlocks[newRootUuid]?.parentUuid
    const parentIndex = formerParentUuid ? finalRoots.indexOf(formerParentUuid) : -1
    if (parentIndex !== -1) {
      finalRoots.splice(parentIndex + 1, 0, newRootUuid)
    } else {
      finalRoots.push(newRootUuid)
    }
  }

  return { blockMap, finalRoots }
}
