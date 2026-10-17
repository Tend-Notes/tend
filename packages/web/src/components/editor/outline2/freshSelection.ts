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
// The DOM selection is the authority here: `view.posAtDOM` maps it back to
// document positions (a caret or a range, so a just-double-clicked word counts
// too), and the command then runs against a state that agrees with the screen.

import { TextSelection, type Command } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

/**
 * The browser's selection as document positions, or null when it isn't inside
 * this view or can't be mapped (a widget's internals, say).
 */
function selectionFromDom(view: EditorView): { anchor: number; head: number } | null {
  const sel = view.dom.ownerDocument.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const { anchorNode, anchorOffset, focusNode, focusOffset } = sel
  if (!anchorNode || !focusNode) return null
  if (!view.dom.contains(anchorNode) || !view.dom.contains(focusNode)) return null
  try {
    return {
      anchor: view.posAtDOM(anchorNode, anchorOffset),
      head: view.posAtDOM(focusNode, focusOffset),
    }
  } catch {
    // posAtDOM throws for a node the view doesn't own.
    return null
  }
}

/**
 * Wrap a command so it sees the on-screen selection — a caret the user just
 * clicked, or a range they just double-clicked. A no-op when the stored
 * selection already matches or the DOM selection can't be mapped.
 */
export function withFreshSelection(cmd: Command): Command {
  return (state, dispatch, view) => {
    // Never touch the selection mid-composition: an IME's own caret handling
    // must win, and the DOM there is transient.
    if (!view || view.composing) return cmd(state, dispatch, view)

    const dom = selectionFromDom(view)
    if (
      dom === null ||
      (dom.anchor === state.selection.anchor && dom.head === state.selection.head)
    ) {
      return cmd(state, dispatch, view)
    }

    const select = (doc: typeof state.doc) =>
      TextSelection.create(doc, dom.anchor, dom.head)

    // Dry run (the keymap probing which command handles the key): answer for
    // the selection the command would actually act on.
    if (!dispatch) {
      return cmd(state.apply(state.tr.setSelection(select(state.doc))), undefined, view)
    }

    // Commit the selection first so undo/redo and other plugins see it, then
    // run the command against the view's updated state.
    view.dispatch(view.state.tr.setSelection(select(view.state.doc)))
    return cmd(view.state, view.dispatch.bind(view), view)
  }
}
