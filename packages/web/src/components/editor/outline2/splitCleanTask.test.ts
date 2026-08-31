// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Pressing Enter inside a task must birth a CLEAN bullet: the new bullet never
// inherits the split block's task metadata (dates, priority, work_log — all in
// `properties`), no matter where in the line the caret sits. splitListItem alone
// only guards the end-of-line case; splitListItemCleanTask covers every caret
// position. These tests drive the real command over the real schema.

import { describe, it, expect } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import type { Page } from '../../../types'
import { pageToDoc } from './pageDoc'
import { outlinerLayer, textLayer, composeLayers } from './layers'
import { splitListItemCleanTask } from './commands'

const META = { due_date: '2026-09-01', start_date: '2026-09-01', priority: 'A', work_log: '[{"durationMs":0}]' }

// One task block "TODO task" carrying full metadata.
function taskPage(): Pick<Page, 'blocks' | 'rootBlocks'> {
  return {
    rootBlocks: ['a'],
    blocks: {
      a: { uuid: 'a', content: 'TODO task', parentUuid: null, children: [], collapsed: false, properties: { ...META }, depth: 0 },
    },
  }
}

function buildState() {
  const { plugins } = composeLayers([outlinerLayer(), textLayer()])
  return EditorState.create({ doc: pageToDoc(taskPage()), plugins })
}

// Inner text position of the first line: [start .. start+len].
function firstLineRange(doc: EditorState['doc']): { start: number; end: number } {
  let start = -1
  let len = 0
  doc.descendants((node, p) => {
    if (start < 0 && node.type.name === 'line') {
      start = p + 1
      len = node.content.size
    }
  })
  return { start, end: start + len }
}

// Every list_item's line text + properties, in document order.
function items(doc: EditorState['doc']): { text: string; props: Record<string, unknown> }[] {
  const out: { text: string; props: Record<string, unknown> }[] = []
  doc.descendants((node) => {
    if (node.type.name === 'list_item') out.push({ text: node.child(0).textContent, props: node.attrs.properties })
  })
  return out
}

// Apply Enter (splitListItemCleanTask) with the caret at `caret`.
function splitAt(caret: number): EditorState {
  const state = buildState()
  const withCaret = state.apply(state.tr.setSelection(TextSelection.create(state.doc, caret)))
  let next = withCaret
  splitListItemCleanTask()(withCaret, (tr) => { next = withCaret.apply(tr) })
  return next
}

describe('splitListItemCleanTask — new bullet never inherits task metadata', () => {
  it('end-of-line split: original keeps metadata, new empty bullet is clean', () => {
    const { end } = firstLineRange(buildState().doc)
    const result = items(splitAt(end).doc)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ text: 'TODO task', props: META }) // original retained
    expect(result[1].props).toEqual({}) // new bullet clean
  })

  it('middle split: original keeps metadata, continuation bullet is clean', () => {
    const { start } = firstLineRange(buildState().doc)
    const result = items(splitAt(start + 4).doc) // after "TODO"
    expect(result).toHaveLength(2)
    expect(result[0].props).toEqual(META) // first half keeps metadata
    expect(result[1].props).toEqual({}) // continuation clean
  })

  it('start-of-line split: the block keeping the text keeps metadata, new empty bullet is clean', () => {
    const { start } = firstLineRange(buildState().doc)
    const result = items(splitAt(start).doc)
    expect(result).toHaveLength(2)
    const textBlock = result.find((r) => r.text === 'TODO task')!
    const emptyBlock = result.find((r) => r.text === '')!
    expect(textBlock.props).toEqual(META) // metadata stays with the text
    expect(emptyBlock.props).toEqual({}) // new empty bullet clean
  })
})
