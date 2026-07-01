// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Centralized uuid minting: after any structural edit (split/sink/lift/paste),
// some list_items may have an empty uuid (freshly created) or a duplicated uuid
// (copied by a command). This appendTransaction guarantees every list_item ends
// up with a unique uuid, so the split/merge/move commands never have to manage
// uuids themselves.

import { Plugin } from 'prosemirror-state'
import { v4 as uuidv4 } from 'uuid'

export function uuidPlugin(): Plugin {
  return new Plugin({
    appendTransaction(trs, _oldState, newState) {
      if (!trs.some((tr) => tr.docChanged)) return null

      const seen = new Set<string>()
      const fixes: { pos: number; attrs: Record<string, unknown> }[] = []

      newState.doc.descendants((node, pos) => {
        if (node.type.name !== 'list_item') return
        const uuid = node.attrs.uuid as string
        if (!uuid || seen.has(uuid)) {
          fixes.push({ pos, attrs: { ...node.attrs, uuid: uuidv4() } })
        } else {
          seen.add(uuid)
        }
      })

      if (fixes.length === 0) return null
      const tr = newState.tr
      for (const f of fixes) {
        // Re-mark seen for the newly assigned uuid (unique by construction).
        tr.setNodeMarkup(f.pos, undefined, f.attrs)
      }
      tr.setMeta('addToHistory', false)
      return tr
    },
  })
}
