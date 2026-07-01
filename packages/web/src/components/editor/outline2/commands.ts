// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Custom outline commands not provided by prosemirror-schema-list: move a block
// (with its subtree) among its siblings, and toggle collapse.

import { Command, TextSelection } from 'prosemirror-state'

// Depth of the enclosing list_item for the current selection, or -1.
function listItemDepth(state: Parameters<Command>[0]): number {
  const $from = state.selection.$from
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'list_item') return d
  }
  return -1
}

// Move the current list_item up (-1) or down (+1) among its siblings. Because a
// list_item contains its own children, the whole subtree moves with it.
export function moveListItem(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const $from = state.selection.$from
    const d = listItemDepth(state)
    if (d < 0) return false

    const item = $from.node(d)
    const itemStart = $from.before(d)
    const parent = $from.node(d - 1)
    const index = $from.index(d - 1)
    const target = index + dir
    if (target < 0 || target >= parent.childCount) return false

    if (!dispatch) return true

    const caretOffset = $from.parentOffset // caret position within the line
    const itemEnd = itemStart + item.nodeSize
    const tr = state.tr
    tr.delete(itemStart, itemEnd)

    let insertPos: number
    if (dir === -1) insertPos = itemStart - parent.child(index - 1).nodeSize
    else insertPos = itemStart + parent.child(index + 1).nodeSize

    tr.insert(insertPos, item)
    // Restore the caret inside the moved item's line (line inner start = +2).
    const caret = insertPos + 2 + caretOffset
    tr.setSelection(TextSelection.create(tr.doc, caret)).scrollIntoView()
    dispatch(tr)
    return true
  }
}

// Toggle the collapsed attr of the current list_item.
export function toggleCollapse(): Command {
  return (state, dispatch) => {
    const $from = state.selection.$from
    const d = listItemDepth(state)
    if (d < 0) return false
    const item = $from.node(d)
    const itemPos = $from.before(d)
    if (!dispatch) return true
    dispatch(state.tr.setNodeMarkup(itemPos, undefined, { ...item.attrs, collapsed: !item.attrs.collapsed }))
    return true
  }
}
