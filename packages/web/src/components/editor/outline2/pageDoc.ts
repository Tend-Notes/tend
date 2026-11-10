// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Page <-> ProseMirror document mapping (list schema). The tree is explicit on
// both sides — direct structural walks, no indentation parsing, no uuid
// re-derivation. `docToBlocks` returns a flat pre-order Block[] + rootBlocks,
// shaped for pageStore.updateCurrentPage.

import { Node as PMNode } from 'prosemirror-model'
import { v4 as uuidv4 } from 'uuid'
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

// A page with no blocks still needs one bullet to type into. It gets a real
// uuid here rather than an empty one: the uuid plugin only mints on structural
// edits, so an empty uuid would survive plain typing all the way into the save
// payload, where the server rejects the block with 400 "Invalid UUID" — and the
// save retries, so the user sees a loop rather than a single error.
function emptyDoc() {
  return {
    type: 'doc',
    content: [
      {
        type: 'bullet_list',
        content: [
          {
            type: 'list_item',
            attrs: { uuid: uuidv4(), collapsed: false, properties: {} },
            content: [{ type: 'line' }],
          },
        ],
      },
    ],
  }
}

export function pageToDoc(page: Pick<Page, 'blocks' | 'rootBlocks'>): PMNode {
  const roots = page.rootBlocks.filter((u) => page.blocks[u])
  if (roots.length === 0) return outlineSchema.nodeFromJSON(emptyDoc())
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

  // Last line of defence: a block that reaches the server without a uuid is
  // rejected, and the save retries, so the user gets an error loop instead of
  // one failure. Whatever produced the gap, mint here — keyed by node identity
  // so a parent's `children` and the item's own id agree.
  const minted = new Map<PMNode, string>()
  const idOf = (item: PMNode): string => {
    const existing = item.attrs.uuid as string
    if (existing) return existing
    let id = minted.get(item)
    if (!id) {
      id = uuidv4()
      minted.set(item, id)
    }
    return id
  }

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
    const uuid = idOf(item)
    const content = item.child(0).textContent
    const kids = childItems(item)
    blocks.push({
      uuid,
      content,
      parentUuid,
      children: kids.map(idOf),
      collapsed: !!item.attrs.collapsed,
      properties: (item.attrs.properties as Record<string, string>) ?? {},
      depth,
    })
    kids.forEach((k) => walk(k, uuid, depth + 1))
  }

  const topList = doc.child(0) // bullet_list
  topList.forEach((item) => {
    rootBlocks.push(idOf(item))
    walk(item, null, 0)
  })

  return { blocks, rootBlocks }
}
