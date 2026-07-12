// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Page <-> ProseMirror document mapping for Longform Mode. The page's single
// block holds the entire markdown body as one string; the editor renders it as
// a flat stack of `line` nodes (one per hard newline). No tree, no uuids in the
// doc — the single block's uuid is threaded separately (see LongformEditor).

import { Node as PMNode } from 'prosemirror-model'
import type { Block, Page } from '../../../types'
import { longformSchema } from './schema'

// Split the single block's content on hard newlines into `line` nodes. Empty
// content yields one empty line (the schema requires `line+`).
export function pageToDocFlat(page: Pick<Page, 'blocks' | 'rootBlocks'>): PMNode {
  const rootUuid = page.rootBlocks.find((u) => page.blocks[u])
  const content = rootUuid ? page.blocks[rootUuid].content : ''
  const lines = content.split('\n')
  return longformSchema.nodeFromJSON({
    type: 'doc',
    content: lines.map((text) => ({
      type: 'line',
      content: text ? [{ type: 'text', text }] : [],
    })),
  })
}

export interface DocBlocks {
  blocks: Block[]
  rootBlocks: string[]
}

// Join the `line` nodes back into the single block's content. The block's uuid
// (and thus stable identity for references/sync) is supplied by the caller.
export function docToBlocksFlat(doc: PMNode, uuid: string): DocBlocks {
  const lines: string[] = []
  doc.forEach((node) => {
    if (node.type.name === 'line') lines.push(node.textContent)
  })
  const block: Block = {
    uuid,
    content: lines.join('\n'),
    parentUuid: null,
    children: [],
    collapsed: false,
    properties: {},
    depth: 0,
  }
  return { blocks: [block], rootBlocks: [uuid] }
}
