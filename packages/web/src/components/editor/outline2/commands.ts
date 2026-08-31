// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Custom outline commands not provided by prosemirror-schema-list: move a block
// (with its subtree) among its siblings, and toggle collapse.

import { Command, TextSelection, Transaction } from 'prosemirror-state'
import { splitListItem } from 'prosemirror-schema-list'
import { listItemType } from './schema'

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

// Clear task metadata (`properties`) from the freshly-created bullet after a
// split. splitListItem only honors our empty-attrs override when the caret is at
// the very end of the line; for a split anywhere else it copies the whole block's
// `properties` — due/start dates, priority, work_log — onto the new bullet. The
// split always leaves the caret in the SECOND of the two sibling blocks, so the
// new (empty) bullet is either that block (end/middle split) or its previous
// sibling (start-of-line split, where the new empty bullet is created above). We
// clear whichever is empty; a middle split has neither empty, so we clear the
// caret block (the continuation). The retained block — the one holding the user's
// original text — always keeps its metadata.
function clearNewBulletProperties(tr: Transaction) {
  const $head = tr.selection.$head
  let d = $head.depth
  while (d > 0 && $head.node(d).type !== listItemType) d--
  if (d === 0) return

  const cursorItem = $head.node(d)
  const cursorPos = $head.before(d) // position just before the caret's list_item
  const listIndex = $head.index(d - 1) // its index within the enclosing bullet_list
  const parentList = $head.node(d - 1)

  let targetPos = cursorPos
  let targetNode = cursorItem
  if (listIndex > 0) {
    const prev = parentList.child(listIndex - 1)
    if (prev.type === listItemType && prev.child(0).textContent.length === 0) {
      targetNode = prev
      targetPos = cursorPos - prev.nodeSize
    }
  }

  const props = (targetNode.attrs.properties as Record<string, unknown>) ?? {}
  if (Object.keys(props).length > 0) {
    tr.setNodeMarkup(targetPos, undefined, { ...targetNode.attrs, properties: {} })
  }
}

// Enter inside the outline: split the current list_item, then guarantee the new
// bullet starts free of task metadata regardless of where in the line Enter was
// pressed. Wraps prosemirror-schema-list's splitListItem (whose own empty-attrs
// override only applies to end-of-line splits) — see clearNewBulletProperties.
export function splitListItemCleanTask(): Command {
  const split = splitListItem(listItemType, { uuid: '', collapsed: false, properties: {} })
  return (state, dispatch, view) => {
    if (!dispatch) return split(state, undefined, view)
    let captured: Transaction | null = null
    const ok = split(state, (tr) => { captured = tr }, view)
    if (!ok || !captured) return ok
    clearNewBulletProperties(captured)
    dispatch(captured)
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
