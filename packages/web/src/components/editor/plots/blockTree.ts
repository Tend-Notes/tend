// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Pure tree operations over the block model — no DOM, no React, no store.
// These are the model-driven primitives the outliner's destructive operations
// (cross-block delete, copy) build on, so that collapsed/hidden descendants are
// never silently lost the way DOM-derived block sets lose them.
//
// `TreeState` mirrors the relevant slice of a Page: a uuid->Block map plus the
// ordered root uuids. All functions are pure and immutable.

import type { Block } from '../../../types'

export interface TreeState {
  blocks: Record<string, Block>
  rootBlocks: string[]
}

/**
 * The transitive closure of `uuids` plus all their descendants, walking the
 * model's `children` (so collapsed/hidden nodes ARE included). Unknown uuids
 * are skipped.
 */
export function descendantClosure(state: TreeState, uuids: Iterable<string>): Set<string> {
  const result = new Set<string>()
  const stack: string[] = [...uuids]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (result.has(id)) continue
    const block = state.blocks[id]
    if (!block) continue
    result.add(id)
    for (const child of block.children) stack.push(child)
  }
  return result
}

/**
 * Remove `uuids` AND their full descendant subtrees, returning a new state with
 * the closure deleted and every surviving parent's `children` / the `rootBlocks`
 * list cleaned of the removed ids. Because the closure includes all descendants,
 * no survivor can reference a deleted ancestor — i.e. no orphans are produced.
 */
export function deleteBlocks(state: TreeState, uuids: Iterable<string>): TreeState {
  const toDelete = descendantClosure(state, uuids)
  const blocks: Record<string, Block> = {}
  for (const [id, block] of Object.entries(state.blocks)) {
    if (toDelete.has(id)) continue
    if (block.children.some((c) => toDelete.has(c))) {
      blocks[id] = { ...block, children: block.children.filter((c) => !toDelete.has(c)) }
    } else {
      blocks[id] = block
    }
  }
  const rootBlocks = state.rootBlocks.filter((id) => !toDelete.has(id))
  return { blocks, rootBlocks }
}

/**
 * Pre-order list of the blocks in the subtree rooted at `uuid` (including
 * `uuid`), from the model — collapsed descendants included.
 */
export function collectSubtree(state: TreeState, uuid: string): Block[] {
  const result: Block[] = []
  const visit = (id: string) => {
    const block = state.blocks[id]
    if (!block) return
    result.push(block)
    for (const child of block.children) visit(child)
  }
  visit(uuid)
  return result
}

/**
 * Deterministic pre-order (tree-order) flattening of the whole state, suitable
 * for passing to `updateCurrentPage(blocks, rootBlocks)`.
 */
export function orderedBlocks(state: TreeState): Block[] {
  const result: Block[] = []
  const visit = (id: string) => {
    const block = state.blocks[id]
    if (!block) return
    result.push(block)
    for (const child of block.children) visit(child)
  }
  state.rootBlocks.forEach(visit)
  return result
}

/**
 * Validate the tree invariants. Returns a list of human-readable problems; an
 * empty array means the tree is well-formed. Intended for tests (run after every
 * structural op) and optionally a dev-only runtime assertion.
 */
export function validateTree(state: TreeState): string[] {
  const problems: string[] = []
  const ids = new Set(Object.keys(state.blocks))
  const rootSet = new Set(state.rootBlocks)

  // How many times each id is referenced (as a root, or as some parent's child).
  const refCount = new Map<string, number>()
  for (const id of state.rootBlocks) refCount.set(id, (refCount.get(id) ?? 0) + 1)

  for (const [id, block] of Object.entries(state.blocks)) {
    if (block.parentUuid && !ids.has(block.parentUuid)) {
      problems.push(`block ${id} has dangling parent ${block.parentUuid}`)
    }
    for (const child of block.children) {
      if (!ids.has(child)) {
        problems.push(`block ${id} has dangling child ${child}`)
      }
      refCount.set(child, (refCount.get(child) ?? 0) + 1)
      const childBlock = state.blocks[child]
      if (childBlock && childBlock.parentUuid !== id) {
        problems.push(`block ${child} listed under ${id} but its parentUuid is ${childBlock.parentUuid}`)
      }
    }
  }

  for (const id of ids) {
    const count = refCount.get(id) ?? 0
    if (count !== 1) {
      problems.push(`block ${id} referenced ${count} time(s) (expected exactly 1)`)
    }
    if (rootSet.has(id)) {
      const block = state.blocks[id]
      if (block && block.parentUuid !== null) {
        problems.push(`root block ${id} has non-null parentUuid ${block.parentUuid}`)
      }
    }
  }

  for (const id of state.rootBlocks) {
    if (!ids.has(id)) problems.push(`rootBlock ${id} missing from blocks`)
  }

  // Reachability from roots == every block ⇒ no orphans / cycles.
  const reachable = new Set<string>()
  const stack: string[] = [...state.rootBlocks]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (reachable.has(id)) continue
    const block = state.blocks[id]
    if (!block) continue
    reachable.add(id)
    for (const child of block.children) stack.push(child)
  }
  if (reachable.size !== ids.size) {
    problems.push(`${ids.size - reachable.size} block(s) unreachable from roots (orphan or cycle)`)
  }

  return problems
}
