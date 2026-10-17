// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Run a structural command against the caret the user can SEE, not the one
// ProseMirror has got around to recording.
//
// ProseMirror only learns about a click-moved caret when the browser fires
// `selectionchange`, which is asynchronous. A key pressed before that lands
// runs against the previous selection — so clicking a bullet and immediately
// pressing Alt+ArrowUp moved the *previously* focused bullet instead. Typing is
// unaffected (it goes through the DOM-mutation path), which is why this only
// ever showed up on the structural keys.
//
// The DOM selection is the authority here: `view.posAtDOM` maps it back to a
// document position, and the command then runs against a state that agrees with
// the screen.

import { TextSelection, type Command } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

/** Document position of the browser's collapsed caret inside the view, if any. */
function caretPosFromDom(view: EditorView): number | null {
  const sel = view.dom.ownerDocument.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null
  const { focusNode, focusOffset } = sel
  if (!focusNode || !view.dom.contains(focusNode)) return null
  try {
    return view.posAtDOM(focusNode, focusOffset)
  } catch {
    // posAtDOM throws for a node the view doesn't own (e.g. a widget's inside).
    return null
  }
}

/**
 * Wrap a command so it sees the on-screen caret. A no-op when the stored
 * selection already matches, when the selection isn't a plain caret, or when
 * the DOM position can't be mapped.
 */
export function withFreshSelection(cmd: Command): Command {
  return (state, dispatch, view) => {
    if (!view || !state.selection.empty) return cmd(state, dispatch, view)

    const pos = caretPosFromDom(view)
    if (pos === null || pos === state.selection.head) return cmd(state, dispatch, view)

    // Dry run (keymap probing which command handles the key): answer for the
    // position the command would actually act on.
    const synced = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, pos))
    )
    if (!dispatch) return cmd(synced, undefined, view)

    // Commit the caret first so undo/redo and any other plugin see it, then run
    // the command against the view's updated state.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
    return cmd(view.state, view.dispatch.bind(view), view)
  }
}
