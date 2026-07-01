// SPDX-License-Identifier: MIT WITH Commons-Clause
import { describe, it, expect } from 'vitest'
import type { Block, Page } from '../../../types'
import { pageToDoc, docToBlocks } from './pageDoc'

function block(uuid: string, content: string, parentUuid: string | null, children: string[], collapsed = false, properties: Record<string, string> = {}): Block {
  return { uuid, content, parentUuid, children, collapsed, properties, depth: 0 }
}

// Tree:  A -> (B -> C, D);  E
function samplePage(): Pick<Page, 'blocks' | 'rootBlocks'> {
  return {
    rootBlocks: ['A', 'E'],
    blocks: {
      A: block('A', 'alpha', null, ['B', 'D']),
      B: block('B', 'beta **bold**', 'A', ['C'], true, { k: 'v' }),
      C: block('C', 'gamma', 'B', []),
      D: block('D', '', 'A', []),
      E: block('E', 'epsilon [[Link]]', null, []),
    },
  }
}

describe('pageDoc round-trip', () => {
  it('page -> doc -> blocks preserves structure, content, uuids, collapsed, properties', () => {
    const page = samplePage()
    const { blocks, rootBlocks } = docToBlocks(pageToDoc(page))

    expect(rootBlocks).toEqual(['A', 'E'])
    // Pre-order: A, B, C, D, E
    expect(blocks.map((b) => b.uuid)).toEqual(['A', 'B', 'C', 'D', 'E'])

    const byId = Object.fromEntries(blocks.map((b) => [b.uuid, b]))
    expect(byId.A.children).toEqual(['B', 'D'])
    expect(byId.B.children).toEqual(['C'])
    expect(byId.B.parentUuid).toBe('A')
    expect(byId.C.parentUuid).toBe('B')
    expect(byId.B.content).toBe('beta **bold**')
    expect(byId.D.content).toBe('')
    expect(byId.B.collapsed).toBe(true)
    expect(byId.B.properties).toEqual({ k: 'v' })
    expect(byId.A.depth).toBe(0)
    expect(byId.B.depth).toBe(1)
    expect(byId.C.depth).toBe(2)
  })

  it('produces a valid PM doc that passes its own schema check', () => {
    const doc = pageToDoc(samplePage())
    expect(() => doc.check()).not.toThrow()
  })
})
