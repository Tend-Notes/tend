// SPDX-License-Identifier: MIT WITH Commons-Clause
// Slash command extension for CodeMirror
//
// Detects when user types `/` at start of content or after whitespace
// and provides state for showing the slash command popup.

import { EditorView } from '@codemirror/view'
import { Extension } from '@codemirror/state'

// State for the slash command popup
export interface SlashCommandState {
  // Position of the slash
  from: number
  // Current cursor position (end of typed query)
  to: number
  // The query text (content after /)
  query: string
  // Screen coordinates for popup positioning
  coords: { top: number; left: number }
}

/**
 * Check if slash command should be triggered at the given position.
 * Returns the slash position if valid, or -1 if not.
 */
function findSlashTrigger(doc: string, cursorPos: number): number {
  if (cursorPos === 0) return -1

  // Look backwards for /
  let slashPos = -1
  for (let i = cursorPos - 1; i >= 0; i--) {
    const char = doc[i]
    if (char === '/') {
      slashPos = i
      break
    }
    // Stop if we hit a space before finding /
    if (char === ' ' || char === '\n' || char === '\t') {
      break
    }
  }

  if (slashPos === -1) return -1

  // Slash must be at start of content or after whitespace
  if (slashPos === 0) {
    return slashPos
  }

  const charBefore = doc[slashPos - 1]
  if (charBefore === ' ' || charBefore === '\n' || charBefore === '\t') {
    return slashPos
  }

  return -1
}

/**
 * Creates a state listener that notifies when slash command state changes.
 */
export function slashCommandStateListener(
  onStateChange: (state: SlashCommandState | null) => void
): Extension {
  let lastState: SlashCommandState | null = null

  return EditorView.updateListener.of((update) => {
    if (!update.view.hasFocus) {
      if (lastState !== null) {
        lastState = null
        onStateChange(null)
      }
      return
    }

    const doc = update.state.doc.toString()
    const cursorPos = update.state.selection.main.head

    const slashPos = findSlashTrigger(doc, cursorPos)

    if (slashPos === -1) {
      if (lastState !== null) {
        lastState = null
        onStateChange(null)
      }
      return
    }

    // Extract query (content after /)
    const query = doc.slice(slashPos + 1, cursorPos)

    // Don't trigger if query contains newlines or special chars
    if (query.includes('\n') || query.includes('/')) {
      if (lastState !== null) {
        lastState = null
        onStateChange(null)
      }
      return
    }

    // Get coordinates for popup positioning
    const coords = update.view.coordsAtPos(slashPos)
    const top = coords ? coords.bottom + 4 : 0
    const left = coords ? coords.left : 0

    const newState: SlashCommandState = {
      from: slashPos,
      to: cursorPos,
      query,
      coords: { top, left },
    }

    // Only notify if state changed
    if (
      !lastState ||
      lastState.from !== newState.from ||
      lastState.to !== newState.to ||
      lastState.query !== newState.query
    ) {
      lastState = newState
      onStateChange(newState)
    }
  })
}

/**
 * Complete the slash command by replacing /query with the result.
 */
export function completeSlashCommand(
  view: EditorView,
  state: SlashCommandState,
  replacement: string
): void {
  view.dispatch({
    changes: { from: state.from, to: state.to, insert: replacement },
    selection: { anchor: state.from + replacement.length },
  })
  view.focus()
}

/**
 * Cancel the slash command by removing the /query.
 */
export function cancelSlashCommand(
  view: EditorView,
  state: SlashCommandState
): void {
  view.dispatch({
    changes: { from: state.from, to: state.to, insert: '' },
  })
  view.focus()
}
