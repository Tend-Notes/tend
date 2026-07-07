// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Slash-command trigger detection for Editor V2. This plugin does one thing:
// expose whether the caret currently sits after a "/query" token in the active
// line, and where it is. Detection mirrors V1's findSlashTrigger (slash at line
// start or after whitespace; query runs to the caret and holds no whitespace).
// Rendering, filtering, and keyboard selection live in the React SlashMenu,
// which reads this state — the same split the rest of outline2 uses (parse in a
// plugin, paint in React).

import { EditorState, Plugin, PluginKey } from 'prosemirror-state'

export interface SlashTrigger {
  // Document position of the '/'.
  from: number
  // Document position of the caret (end of the query).
  to: number
  // Text between the '/' and the caret.
  query: string
}

export const slashMenuKey = new PluginKey<SlashTrigger | null>('slashMenu')

function detect(state: EditorState): SlashTrigger | null {
  const sel = state.selection
  // Only when the caret is a plain collapsed cursor inside a line's text.
  if (!sel.empty) return null
  const $head = sel.$head
  if ($head.parent.type.name !== 'line') return null

  const offset = $head.parentOffset
  if (offset === 0) return null
  const text = $head.parent.textContent

  // Walk back from the caret to the nearest '/', bailing on whitespace.
  let slash = -1
  for (let i = offset - 1; i >= 0; i--) {
    const ch = text[i]
    if (ch === '/') { slash = i; break }
    if (ch === ' ' || ch === '\t' || ch === '\n') return null
  }
  if (slash === -1) return null

  // The '/' must begin a word: at line start or right after whitespace.
  if (slash > 0) {
    const before = text[slash - 1]
    if (before !== ' ' && before !== '\t' && before !== '\n') return null
  }

  const query = text.slice(slash + 1, offset)
  if (/\s/.test(query)) return null

  const lineStart = $head.start() // first inline position of the line
  return { from: lineStart + slash, to: lineStart + offset, query }
}

export function slashMenuPlugin(): Plugin<SlashTrigger | null> {
  return new Plugin<SlashTrigger | null>({
    key: slashMenuKey,
    state: {
      init: (_config, state) => detect(state),
      apply: (_tr, _value, _oldState, newState) => detect(newState),
    },
  })
}
