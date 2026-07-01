// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Small ProseMirror helpers for wiring the command surface: locating a block by
// uuid and placing/reading the caret. Keeps OutlineEditorV2 lean.

import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { Node as PMNode } from 'prosemirror-model'

// Position of the list_item node with this uuid, plus the inline start of its line.
function locate(doc: PMNode, uuid: string): { itemPos: number; lineInnerStart: number; lineSize: number } | null {
  let hit: { itemPos: number; lineInnerStart: number; lineSize: number } | null = null
  doc.descendants((node, pos) => {
    if (hit) return false
    if (node.type.name === 'list_item' && node.attrs.uuid === uuid) {
      const line = node.child(0)
      // list_item content starts at pos+1 (the line node); its inline content at pos+2.
      hit = { itemPos: pos, lineInnerStart: pos + 2, lineSize: line.content.size }
      return false
    }
    return undefined
  })
  return hit
}

export type FocusPosition = number | 'start' | 'end'

// Move the caret into the block's line and focus the view.
export function focusBlock(view: EditorView, uuid: string, position: FocusPosition): boolean {
  const loc = locate(view.state.doc, uuid)
  if (!loc) return false
  let offset: number
  if (position === 'start') offset = 0
  else if (position === 'end') offset = loc.lineSize
  else offset = Math.max(0, Math.min(position, loc.lineSize))
  const pos = loc.lineInnerStart + offset
  const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)).scrollIntoView()
  view.dispatch(tr)
  view.focus()
  return true
}

// The uuid of the list_item containing the current selection head.
export function blockUuidAtSelection(state: EditorState): string | null {
  const $from = state.selection.$from
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name === 'list_item') return (node.attrs.uuid as string) || null
  }
  return null
}
