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

// Regression: a brand-new sheet has no blocks, so the editor renders a single
// placeholder bullet. That bullet used to carry an empty uuid, which the uuid
// plugin minted on the first keystroke — until the plugin learned to skip plain
// typing. The empty uuid then survived into the save payload, and the server
// rejects it with 400 "Invalid UUID" on every retry.
describe('a page with no blocks', () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  it('gives its placeholder bullet a real uuid', () => {
    const { blocks, rootBlocks } = docToBlocks(pageToDoc({ blocks: {}, rootBlocks: [] }))

    expect(blocks).toHaveLength(1)
    expect(blocks[0].uuid).toMatch(UUID_RE)
    expect(rootBlocks).toEqual([blocks[0].uuid])
  })

  it('mints a different uuid each time, so two new sheets cannot collide', () => {
    const first = docToBlocks(pageToDoc({ blocks: {}, rootBlocks: [] })).blocks[0].uuid
    const second = docToBlocks(pageToDoc({ blocks: {}, rootBlocks: [] })).blocks[0].uuid

    expect(first).not.toBe(second)
  })
})

describe('docToBlocks uuid backstop', () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  it('never emits a block without a uuid, whatever the doc holds', () => {
    // Belt and braces: the editor should not produce an empty uuid, but a block
    // that reaches the server without one costs the user a save loop, so this
    // is the last line of defence rather than an assumption.
    const doc = pageToDoc({
      rootBlocks: ['A'],
      blocks: {
        A: block('A', 'parent', null, ['']),
        '': block('', 'child with no uuid', 'A', []),
      },
    })
    const { blocks, rootBlocks } = docToBlocks(doc)

    expect(blocks).toHaveLength(2)
    // Existing ids are left alone; only the missing one is minted.
    for (const b of blocks) expect(b.uuid).not.toBe('')
    expect(blocks.find((b) => b.content === 'child with no uuid')!.uuid).toMatch(UUID_RE)
    expect(rootBlocks).toEqual(['A'])

    // And the parent/child wiring still refers to the minted ids.
    const parent = blocks.find((b) => b.content === 'parent')!
    const child = blocks.find((b) => b.content === 'child with no uuid')!
    expect(parent.children).toEqual([child.uuid])
    expect(child.parentUuid).toBe(parent.uuid)
  })
})
