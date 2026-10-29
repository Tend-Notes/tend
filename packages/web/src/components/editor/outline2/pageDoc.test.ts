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

describe('a page with no blocks', () => {
  it('gives the placeholder item a real uuid', () => {
    // The bug this closes: the placeholder used to carry uuid '', on the
    // assumption that uuidPlugin would fill it in. That plugin skips the scan
    // for inline-only steps, and typing is inline-only — so the first
    // keystroke on a brand-new page sent a block with no uuid and the save was
    // rejected with "Invalid block UUID". Every new journal hit it.
    const { blocks, rootBlocks } = docToBlocks(pageToDoc({ blocks: {}, rootBlocks: [] }))

    expect(blocks).toHaveLength(1)
    expect(blocks[0].uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(rootBlocks).toEqual([blocks[0].uuid])
  })

  it('gives a different uuid each time, so two pages do not share one', () => {
    const first = docToBlocks(pageToDoc({ blocks: {}, rootBlocks: [] }))
    const second = docToBlocks(pageToDoc({ blocks: {}, rootBlocks: [] }))
    expect(first.blocks[0].uuid).not.toBe(second.blocks[0].uuid)
  })
})

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
