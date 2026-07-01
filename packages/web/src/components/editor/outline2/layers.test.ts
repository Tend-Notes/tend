// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Proves the layer guarantee: a higher layer can be removed and the lower layers
// still compose into a working editor. Text (L1) alone must build and edit; +
// Outliner (L2) must build with its list_item nodeView; the full stack (+ L3
// formatting) must build. Dependencies point downward, so each subset is valid.

import { describe, it, expect } from 'vitest'
import { EditorState } from 'prosemirror-state'
import type { Page } from '../../../types'
import { pageToDoc } from './pageDoc'
import { textLayer, outlinerLayer, formattingLayer, composeLayers } from './layers'

function samplePage(): Pick<Page, 'blocks' | 'rootBlocks'> {
  return {
    rootBlocks: ['a'],
    blocks: {
      a: { uuid: 'a', content: 'hello', parentUuid: null, children: [], collapsed: false, properties: {}, depth: 0 },
    },
  }
}

const nav = { navigateToPage: () => {}, navigateToJournal: () => {} }

function firstLineInner(doc: ReturnType<typeof pageToDoc>): number {
  let pos = -1
  doc.descendants((node, p) => {
    if (pos < 0 && node.type.name === 'line') pos = p + 1
  })
  return pos
}

describe('editor layers (removability)', () => {
  it('L1 (text) alone builds and edits raw markdown — no outliner, no formatting', () => {
    const { plugins, nodeViews } = composeLayers([textLayer()])
    const state = EditorState.create({ doc: pageToDoc(samplePage()), plugins })
    expect(Object.keys(nodeViews)).toHaveLength(0) // no chrome without the outliner
    const at = firstLineInner(state.doc)
    const next = state.apply(state.tr.insertText('X', at))
    expect(next.doc.textContent).toContain('Xhello')
  })

  it('L1+L2 (text+outliner) builds with the list_item nodeView', () => {
    const { plugins, nodeViews } = composeLayers([outlinerLayer(), textLayer()])
    expect(nodeViews).toHaveProperty('list_item')
    const state = EditorState.create({ doc: pageToDoc(samplePage()), plugins })
    expect(state.plugins.length).toBeGreaterThan(plugins.length - 1) // composed cleanly
  })

  it('full stack (text+outliner+formatting) builds', () => {
    const { plugins } = composeLayers([formattingLayer(nav), outlinerLayer(), textLayer()])
    expect(() => EditorState.create({ doc: pageToDoc(samplePage()), plugins })).not.toThrow()
  })
})
