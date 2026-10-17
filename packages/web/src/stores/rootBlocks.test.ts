// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// computeRootBlocks replaced three hand-rolled copies in pageStore, so these
// pin the ordering rules all three relied on — especially the current-page
// rule that an outdented block lands next to its former parent.

import { describe, it, expect } from 'vitest'
import type { Block } from '../types'
import { computeRootBlocks } from './rootBlocks'

function block(uuid: string, parentUuid: string | null = null): Block {
  return { uuid, content: uuid, parentUuid, children: [], collapsed: false, properties: {}, depth: 0 }
}

describe('computeRootBlocks', () => {
  it('maps blocks by uuid', () => {
    const blocks = [block('a'), block('b', 'a')]
    const { blockMap } = computeRootBlocks(blocks, undefined, [])
    expect(Object.keys(blockMap).sort()).toEqual(['a', 'b'])
  })

  it('takes the hint order, dropping uuids that are not roots', () => {
    const blocks = [block('a'), block('b'), block('c', 'a')]
    const { finalRoots } = computeRootBlocks(blocks, ['b', 'c', 'a'], ['a', 'b'])
    expect(finalRoots).toEqual(['b', 'a'])
  })

  it('appends roots the hint missed', () => {
    const blocks = [block('a'), block('b'), block('c')]
    const { finalRoots } = computeRootBlocks(blocks, ['b'], [])
    expect(finalRoots).toEqual(['b', 'a', 'c'])
  })

  it('preserves the previous order and appends new roots without previousBlocks', () => {
    const blocks = [block('a'), block('b'), block('new')]
    const { finalRoots } = computeRootBlocks(blocks, undefined, ['b', 'a'])
    expect(finalRoots).toEqual(['b', 'a', 'new'])
  })

  it('drops previous roots that are no longer roots', () => {
    const blocks = [block('a'), block('b', 'a')]
    const { finalRoots } = computeRootBlocks(blocks, undefined, ['a', 'b'])
    expect(finalRoots).toEqual(['a'])
  })

  it('inserts an outdented block after its former parent', () => {
    // 'child' was a child of 'a'; it is a root now.
    const previousBlocks = { a: block('a'), child: block('child', 'a'), b: block('b') }
    const blocks = [block('a'), block('child'), block('b')]
    const { finalRoots } = computeRootBlocks(blocks, undefined, ['a', 'b'], { previousBlocks })
    expect(finalRoots).toEqual(['a', 'child', 'b'])
  })

  it('appends an outdented block whose former parent is not a root', () => {
    const previousBlocks = { a: block('a'), mid: block('mid', 'a'), leaf: block('leaf', 'mid') }
    const blocks = [block('a'), block('mid', 'a'), block('leaf')]
    const { finalRoots } = computeRootBlocks(blocks, undefined, ['a'], { previousBlocks })
    expect(finalRoots).toEqual(['a', 'leaf'])
  })

  // Quirk carried over verbatim from the three copies: each promoted block is
  // inserted directly after the former parent, so a run of siblings ends up
  // reversed. Pinned here as behavior-of-record, not as a desirable rule.
  it('inserts each sibling directly after the former parent (reversing a run)', () => {
    const previousBlocks = {
      a: block('a'),
      x: block('x', 'a'),
      y: block('y', 'a'),
      b: block('b'),
    }
    const blocks = [block('a'), block('x'), block('y'), block('b')]
    const { finalRoots } = computeRootBlocks(blocks, undefined, ['a', 'b'], { previousBlocks })
    expect(finalRoots).toEqual(['a', 'y', 'x', 'b'])
  })
})
