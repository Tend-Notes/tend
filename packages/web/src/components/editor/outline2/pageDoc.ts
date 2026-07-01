// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Page <-> ProseMirror document mapping. The tree is explicit on both sides, so
// these are direct structural walks — no indentation parsing, no uuid
// re-derivation. `docToBlocks` returns a flat pre-order Block[] + rootBlocks,
// shaped for pageStore.updateCurrentPage.

import { Node as PMNode } from 'prosemirror-model'
import type { Block, Page } from '../../../types'
import { outlineSchema } from './schema'

// Build a `block` node's JSON from the model, recursing into children.
function blockToJSON(page: Pick<Page, 'blocks'>, uuid: string): Record<string, unknown> {
  const b = page.blocks[uuid]
  const line = {
    type: 'line',
    content: b.content ? [{ type: 'text', text: b.content }] : [],
  }
  const children = b.children
    .filter((c) => page.blocks[c])
    .map((c) => blockToJSON(page, c))
  return {
    type: 'block',
    attrs: { uuid, collapsed: b.collapsed, properties: b.properties },
    content: [line, ...children],
  }
}

export function pageToDoc(page: Pick<Page, 'blocks' | 'rootBlocks'>): PMNode {
  const content = page.rootBlocks
    .filter((u) => page.blocks[u])
    .map((u) => blockToJSON(page, u))
  // A doc must have at least one block; callers guarantee non-empty pages, but
  // guard anyway with an empty block so the schema is satisfied.
  if (content.length === 0) {
    return outlineSchema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'block', attrs: { uuid: 'empty', collapsed: false, properties: {} }, content: [{ type: 'line' }] }],
    })
  }
  return outlineSchema.nodeFromJSON({ type: 'doc', content })
}

export interface DocBlocks {
  blocks: Block[]
  rootBlocks: string[]
}

// Walk the doc into a flat pre-order Block[] + rootBlocks. Node 0 of each block
// is its `line`; nodes 1.. are child blocks.
export function docToBlocks(doc: PMNode): DocBlocks {
  const blocks: Block[] = []
  const rootBlocks: string[] = []

  const walk = (node: PMNode, parentUuid: string | null, depth: number) => {
    const uuid = node.attrs.uuid as string
    const line = node.child(0)
    const content = line.textContent
    const childUuids: string[] = []
    for (let i = 1; i < node.childCount; i++) {
      childUuids.push(node.child(i).attrs.uuid as string)
    }
    blocks.push({
      uuid,
      content,
      parentUuid,
      children: childUuids,
      collapsed: !!node.attrs.collapsed,
      properties: (node.attrs.properties as Record<string, string>) ?? {},
      depth,
    })
    for (let i = 1; i < node.childCount; i++) {
      walk(node.child(i), uuid, depth + 1)
    }
  }

  doc.forEach((n) => {
    rootBlocks.push(n.attrs.uuid as string)
    walk(n, null, 0)
  })

  return { blocks, rootBlocks }
}
