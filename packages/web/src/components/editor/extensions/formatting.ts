// SPDX-License-Identifier: MIT WITH Commons-Clause
// Formatting keyboard shortcuts for the editor
//
// Alt+Shift+<key> shortcuts for applying markdown formatting:
// - Alt+Shift+B: Bold (**text**)
// - Alt+Shift+I: Italic (*text*)
// - Alt+Shift+U: Underline (not supported in markdown, no-op)
// - Alt+Shift+-: Strikethrough (~~text~~) - dash key, mnemonic for strike-through
// - Alt+Shift+H: Highlight (==text==)

import { keymap } from '@codemirror/view'
import { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/**
 * Wraps the current selection with the given delimiter.
 * If no selection, inserts delimiters and places cursor between them.
 */
function wrapSelection(view: EditorView, delimiter: string): boolean {
  const { state } = view
  const { from, to } = state.selection.main
  const hasSelection = from !== to

  if (hasSelection) {
    // Wrap selection with delimiter
    const selectedText = state.sliceDoc(from, to)
    view.dispatch({
      changes: { from, to, insert: `${delimiter}${selectedText}${delimiter}` },
      selection: { anchor: from + delimiter.length, head: to + delimiter.length },
    })
  } else {
    // No selection - insert delimiters and place cursor between them
    view.dispatch({
      changes: { from, to, insert: `${delimiter}${delimiter}` },
      selection: { anchor: from + delimiter.length },
    })
  }

  return true
}

/**
 * Creates CodeMirror extension with formatting keyboard shortcuts.
 */
export function formattingKeymap(): Extension {
  return keymap.of([
    // Alt+Shift+B: Bold
    {
      key: 'Alt-Shift-b',
      run: (view) => wrapSelection(view, '**'),
    },
    // Alt+Shift+I: Italic
    {
      key: 'Alt-Shift-i',
      run: (view) => wrapSelection(view, '*'),
    },
    // Alt+Shift+U: Underline - markdown doesn't support underline
    // We could use HTML <u> tags but that breaks markdown flow
    // For now, this is a no-op
    {
      key: 'Alt-Shift-u',
      run: () => true, // Consume the event but do nothing
    },
    // Alt+Shift+-: Strikethrough (dash mnemonic for strike-through)
    {
      key: 'Alt-Shift--',
      run: (view) => wrapSelection(view, '~~'),
    },
    // Alt+Shift+H: Highlight
    {
      key: 'Alt-Shift-h',
      run: (view) => wrapSelection(view, '=='),
    },
  ])
}
