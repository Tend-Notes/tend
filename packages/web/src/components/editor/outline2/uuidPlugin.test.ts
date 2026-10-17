// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// The uuid scan walks every list_item in the document, so it must not run on
// plain typing — only a structural step can leave a list_item without a uuid or
// with a duplicate of one. These tests drive real transactions over the real
// schema and assert both halves: typing is skipped, structure is not.

import { describe, it, expect } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { Slice, Fragment } from 'prosemirror-model'
import type { Page } from '../../../types'
import { pageToDoc } from './pageDoc'
import { outlinerLayer, textLayer, composeLayers } from './layers'
import { outlineSchema } from './schema'
import { needsUuidScan } from './uuidPlugin'

function page(): Pick<Page, 'blocks' | 'rootBlocks'> {
  return {
    rootBlocks: ['a', 'b'],
    blocks: {
      a: { uuid: 'a', content: 'first', parentUuid: null, children: [], collapsed: false, properties: {}, depth: 0 },
      b: { uuid: 'b', content: 'second', parentUuid: null, children: [], collapsed: false, properties: {}, depth: 0 },
    },
  }
}

function buildState() {
  const { plugins } = composeLayers([outlinerLayer(), textLayer()])
  return EditorState.create({ doc: pageToDoc(page()), plugins })
}

/** Position inside the first list_item's line. */
function caretInFirstBlock(state: EditorState): number {
  let pos = -1
  state.doc.descendants((node, p) => {
    if (node.type.name === 'line' && pos === -1) pos = p + 1
    return true
  })
  return pos
}

describe('needsUuidScan', () => {
  it('skips plain typing', () => {
    const state = buildState()
    const pos = caretInFirstBlock(state)
    const tr = state.tr.insertText('x', pos)
    expect(tr.docChanged).toBe(true)
    expect(needsUuidScan([tr])).toBe(false)
  })

  it('skips a deletion inside a block', () => {
    const state = buildState()
    const pos = caretInFirstBlock(state)
    const tr = state.tr.delete(pos, pos + 2)
    expect(tr.docChanged).toBe(true)
    expect(needsUuidScan([tr])).toBe(false)
  })

  it('skips a transaction that changes nothing', () => {
    const state = buildState()
    const pos = caretInFirstBlock(state)
    const tr = state.tr.setSelection(TextSelection.create(state.doc, pos))
    expect(needsUuidScan([tr])).toBe(false)
  })

  it('scans after a split', () => {
    const state = buildState()
    const pos = caretInFirstBlock(state)
    const tr = state.tr.split(pos + 1, 2)
    expect(needsUuidScan([tr])).toBe(true)
  })

  it('scans when a slice carrying a list_item is pasted', () => {
    const state = buildState()
    const pos = caretInFirstBlock(state)
    const item = outlineSchema.nodes.list_item.create({ uuid: 'a' }, outlineSchema.nodes.line.create(null, outlineSchema.text('dup')))
    const tr = state.tr.replace(pos, pos, new Slice(Fragment.from(item), 0, 0))
    expect(needsUuidScan([tr])).toBe(true)
  })
})

describe('uuidPlugin', () => {
  it('still mints a uuid for a list_item that lacks one', () => {
    const state = buildState()
    const pos = caretInFirstBlock(state)
    const blank = outlineSchema.nodes.list_item.create({ uuid: '' }, outlineSchema.nodes.line.create(null, outlineSchema.text('new')))
    const tr = state.tr.replace(pos, pos, new Slice(Fragment.from(blank), 0, 0))
    const next = state.apply(tr)

    const uuids: string[] = []
    next.doc.descendants((node) => {
      if (node.type.name === 'list_item') uuids.push(node.attrs.uuid as string)
      return true
    })
    expect(uuids.every((u) => !!u)).toBe(true)
    expect(new Set(uuids).size).toBe(uuids.length)
  })
})
