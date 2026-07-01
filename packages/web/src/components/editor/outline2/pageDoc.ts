// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Page <-> ProseMirror document mapping (list schema). The tree is explicit on
// both sides — direct structural walks, no indentation parsing, no uuid
// re-derivation. `docToBlocks` returns a flat pre-order Block[] + rootBlocks,
// shaped for pageStore.updateCurrentPage.

import { Node as PMNode } from 'prosemirror-model'
import type { Block, Page } from '../../../types'
import { outlineSchema } from './schema'

// Build a list_item's JSON from the model, recursing into children.
function itemToJSON(page: Pick<Page, 'blocks'>, uuid: string): Record<string, unknown> {
  const b = page.blocks[uuid]
  const line = {
    type: 'line',
    content: b.content ? [{ type: 'text', text: b.content }] : [],
  }
  const childUuids = b.children.filter((c) => page.blocks[c])
  const content: Record<string, unknown>[] = [line]
  if (childUuids.length > 0) {
    content.push({ type: 'bullet_list', content: childUuids.map((c) => itemToJSON(page, c)) })
  }
  return { type: 'list_item', attrs: { uuid, collapsed: b.collapsed, properties: b.properties }, content }
}

const EMPTY_DOC = {
  type: 'doc',
  content: [
    {
      type: 'bullet_list',
      content: [{ type: 'list_item', attrs: { uuid: '', collapsed: false, properties: {} }, content: [{ type: 'line' }] }],
    },
  ],
}

export function pageToDoc(page: Pick<Page, 'blocks' | 'rootBlocks'>): PMNode {
  const roots = page.rootBlocks.filter((u) => page.blocks[u])
  if (roots.length === 0) return outlineSchema.nodeFromJSON(EMPTY_DOC)
  return outlineSchema.nodeFromJSON({
    type: 'doc',
    content: [{ type: 'bullet_list', content: roots.map((u) => itemToJSON(page, u)) }],
  })
}

export interface DocBlocks {
  blocks: Block[]
  rootBlocks: string[]
}

// Walk the doc into a flat pre-order Block[] + rootBlocks. A list_item's child 0
// is its `line`; an optional child 1 is a `bullet_list` of its child items.
export function docToBlocks(doc: PMNode): DocBlocks {
  const blocks: Block[] = []
  const rootBlocks: string[] = []

  const childItems = (item: PMNode): PMNode[] => {
    const items: PMNode[] = []
    for (let i = 1; i < item.childCount; i++) {
      const child = item.child(i)
      if (child.type.name === 'bullet_list') {
        child.forEach((li) => items.push(li))
      }
    }
    return items
  }

  const walk = (item: PMNode, parentUuid: string | null, depth: number) => {
    const uuid = item.attrs.uuid as string
    const content = item.child(0).textContent
    const kids = childItems(item)
    blocks.push({
      uuid,
      content,
      parentUuid,
      children: kids.map((k) => k.attrs.uuid as string),
      collapsed: !!item.attrs.collapsed,
      properties: (item.attrs.properties as Record<string, string>) ?? {},
      depth,
    })
    kids.forEach((k) => walk(k, uuid, depth + 1))
  }

  const topList = doc.child(0) // bullet_list
  topList.forEach((item) => {
    rootBlocks.push(item.attrs.uuid as string)
    walk(item, null, 0)
  })

  return { blocks, rootBlocks }
}
