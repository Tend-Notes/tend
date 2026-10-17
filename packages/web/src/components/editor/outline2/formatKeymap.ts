// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Inline formatting keybinds for Editor V2. Formatting is textual (the document
// holds raw markdown; decorations.ts paints it), so "apply bold" == wrap the
// selection in `**`. This is the ProseMirror port of V1's wrapSelection. We use
// standard Mod combos rather than V1's Alt+Shift set: Alt+Shift is Firefox's
// accesskey modifier (fires at browser-chrome level, uninterceptable), whereas
// Ctrl/Cmd keydowns in a focused editor are caught by the keymap — the same
// reason the Ctrl/Cmd+K palette works.

import { Command, TextSelection } from 'prosemirror-state'
import { withFreshSelection } from './freshSelection'

// Wrap the selection in `delim` on both sides. With no selection, insert an
// empty pair and drop the caret between them. Exported so the touch FormatBar
// applies the exact same formatting as the Mod-b/i/e keybinds.
export function wrap(delim: string): Command {
  return (state, dispatch) => {
    const sel = state.selection
    // Only operate within a single text block; a cross-block selection isn't
    // meaningful to wrap in inline markdown.
    if (!sel.empty && !sel.$from.sameParent(sel.$to)) return true

    if (dispatch) {
      const { from, to, empty } = sel
      if (empty) {
        const tr = state.tr.insertText(delim + delim, from, from)
        tr.setSelection(TextSelection.create(tr.doc, from + delim.length))
        dispatch(tr.scrollIntoView())
      } else {
        const inner = state.doc.textBetween(from, to)
        const tr = state.tr.insertText(delim + inner + delim, from, to)
        // Keep the original text selected, now sitting inside the delimiters.
        tr.setSelection(TextSelection.create(tr.doc, from + delim.length, to + delim.length))
        dispatch(tr.scrollIntoView())
      }
    }
    return true
  }
}

// Delimiters match contentRenderer.ts's parser exactly.
//
// withFreshSelection: a selection made with the mouse reaches ProseMirror only
// on the browser's async selectionchange, so a Ctrl+B pressed straight after
// double-clicking a word used to wrap nothing - leaving "****word".
export const formatKeymap: Record<string, Command> = {
  'Mod-b': withFreshSelection(wrap('**')),
  'Mod-i': withFreshSelection(wrap('*')),
  'Mod-e': withFreshSelection(wrap('`')),
  'Mod-Shift-x': withFreshSelection(wrap('~~')),
  'Mod-Shift-h': withFreshSelection(wrap('==')),
}
