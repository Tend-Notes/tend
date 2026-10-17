// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Centralized uuid minting: after any structural edit (split/sink/lift/paste),
// some list_items may have an empty uuid (freshly created) or a duplicated uuid
// (copied by a command). This appendTransaction guarantees every list_item ends
// up with a unique uuid, so the split/merge/move commands never have to manage
// uuids themselves.

import { Plugin } from 'prosemirror-state'
import type { Transaction } from 'prosemirror-state'
import { ReplaceStep, type Step } from 'prosemirror-transform'
import { v4 as uuidv4 } from 'uuid'

/**
 * True when a step can only have changed inline content inside one or more
 * existing textblocks — plain typing, a plain-text paste, a deletion.
 *
 * Such a step cannot introduce a list_item, so it can neither leave one without
 * a uuid nor duplicate an existing one. Anything else (a split, a lift, a sink,
 * a node-markup change, a paste carrying structure, the initial doc) falls
 * through to the full scan, so the check errs toward scanning.
 */
function isInlineOnlyStep(step: Step): boolean {
  if (!(step instanceof ReplaceStep)) return false
  // `structure: true` marks the joins/splits that rearrange nodes.
  if ((step as ReplaceStep & { structure?: boolean }).structure) return false
  const { slice } = step
  if (slice.openStart !== 0 || slice.openEnd !== 0) return false
  let inlineOnly = true
  slice.content.forEach((node) => {
    if (!node.isInline) inlineOnly = false
  })
  return inlineOnly
}

/**
 * Whether these transactions need the uuid scan at all. Exported for the tests:
 * on a large document the scan is O(blocks), and it used to run on every
 * keystroke.
 */
export function needsUuidScan(trs: readonly Transaction[]): boolean {
  if (!trs.some((tr) => tr.docChanged)) return false
  return !trs.every((tr) => tr.steps.every(isInlineOnlyStep))
}

export function uuidPlugin(): Plugin {
  return new Plugin({
    appendTransaction(trs, _oldState, newState) {
      if (!needsUuidScan(trs)) return null

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
