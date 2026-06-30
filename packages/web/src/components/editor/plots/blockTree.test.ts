// SPDX-License-Identifier: MIT WITH Commons-Clause
import { describe, it, expect } from 'vitest'
import type { Block } from '../../../types'
import {
  descendantClosure,
  deleteBlocks,
  collectSubtree,
  orderedBlocks,
  validateTree,
  type TreeState,
} from './blockTree'

function block(uuid: string, parentUuid: string | null, children: string[], collapsed = false): Block {
  return { uuid, content: uuid, parentUuid, children, collapsed, properties: {}, depth: 0 }
}

// Tree:
//   A (root)
//     B (collapsed) -> C (hidden)
//     D
//   E (root)
function sampleState(): TreeState {
  return {
    blocks: {
      A: block('A', null, ['B', 'D']),
      B: block('B', 'A', ['C'], true),
      C: block('C', 'B', []),
      D: block('D', 'A', []),
      E: block('E', null, []),
    },
    rootBlocks: ['A', 'E'],
  }
}

describe('descendantClosure', () => {
  it('includes collapsed/hidden descendants', () => {
    const s = sampleState()
    expect(descendantClosure(s, ['B'])).toEqual(new Set(['B', 'C']))
    expect(descendantClosure(s, ['A'])).toEqual(new Set(['A', 'B', 'C', 'D']))
  })

  it('skips unknown ids', () => {
    expect(descendantClosure(sampleState(), ['nope'])).toEqual(new Set())
  })
})

describe('deleteBlocks', () => {
  it('removes a collapsed parent together with its hidden child, no orphans', () => {
    const next = deleteBlocks(sampleState(), ['B'])
    expect(Object.keys(next.blocks).sort()).toEqual(['A', 'D', 'E'])
    expect(next.blocks.A.children).toEqual(['D']) // B pruned from parent
    expect(next.rootBlocks).toEqual(['A', 'E'])
    expect(validateTree(next)).toEqual([])
  })

  it('removes a whole root subtree and cleans rootBlocks', () => {
    const next = deleteBlocks(sampleState(), ['A'])
    expect(Object.keys(next.blocks)).toEqual(['E'])
    expect(next.rootBlocks).toEqual(['E'])
    expect(validateTree(next)).toEqual([])
  })

  it('is immutable — original state is untouched', () => {
    const s = sampleState()
    deleteBlocks(s, ['B'])
    expect(s.blocks.A.children).toEqual(['B', 'D'])
    expect(s.blocks.C).toBeDefined()
  })
})

describe('collectSubtree', () => {
  it('returns the pre-order subtree including collapsed descendants', () => {
    expect(collectSubtree(sampleState(), 'A').map((b) => b.uuid)).toEqual(['A', 'B', 'C', 'D'])
    expect(collectSubtree(sampleState(), 'B').map((b) => b.uuid)).toEqual(['B', 'C'])
  })
})

describe('orderedBlocks', () => {
  it('flattens the whole tree in pre-order', () => {
    expect(orderedBlocks(sampleState()).map((b) => b.uuid)).toEqual(['A', 'B', 'C', 'D', 'E'])
  })
})

describe('validateTree', () => {
  it('passes a well-formed tree', () => {
    expect(validateTree(sampleState())).toEqual([])
  })

  it('detects an orphan (dangling parent / unreachable)', () => {
    const broken: TreeState = {
      blocks: {
        A: block('A', null, []),
        X: block('X', 'GONE', []), // parent doesn't exist; not in any children/roots
      },
      rootBlocks: ['A'],
    }
    expect(validateTree(broken).length).toBeGreaterThan(0)
  })

  it('detects a block referenced by two parents', () => {
    const broken: TreeState = {
      blocks: {
        A: block('A', null, ['C']),
        B: block('B', null, ['C']),
        C: block('C', 'A', []),
      },
      rootBlocks: ['A', 'B'],
    }
    expect(validateTree(broken).some((p) => p.includes('referenced'))).toBe(true)
  })
})
