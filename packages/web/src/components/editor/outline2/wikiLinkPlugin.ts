// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// `[[` wiki-link trigger detection for Editor V2. Mirrors slashMenuPlugin: it
// only exposes whether the caret sits inside an open `[[query` (not yet closed
// by `]]`), and where it is. Rendering/filtering/selection live in the reused
// WikiLinkPopup, driven by this state. Unlike the slash trigger, the query may
// contain spaces (page titles do), so detection bails only on `]`/`[`/newline.

import { EditorState, Plugin, PluginKey } from 'prosemirror-state'

export interface WikiTrigger {
  // Document position of the first '[' of the opening '[['.
  from: number
  // Document position of the caret (end of the query).
  to: number
  // Text between the '[[' and the caret.
  query: string
}

export const wikiLinkKey = new PluginKey<WikiTrigger | null>('wikiLink')

function detect(state: EditorState): WikiTrigger | null {
  const sel = state.selection
  // Only a plain collapsed cursor inside a line's text.
  if (!sel.empty) return null
  const $head = sel.$head
  if ($head.parent.type.name !== 'line') return null

  const offset = $head.parentOffset
  if (offset < 2) return null // need at least "[[" before the caret
  const text = $head.parent.textContent

  // Walk back to the nearest "[[", bailing if the run is interrupted by a
  // bracket or newline (which means we're not inside an open wiki-link).
  let open = -1
  for (let i = offset - 1; i >= 1; i--) {
    const ch = text[i]
    if (ch === ']' || ch === '[' || ch === '\n') {
      if (ch === '[' && text[i - 1] === '[') {
        open = i - 1
      }
      break
    }
  }
  if (open === -1) return null

  const query = text.slice(open + 2, offset)
  const lineStart = $head.start() // first inline position of the line
  return { from: lineStart + open, to: lineStart + offset, query }
}

export function wikiLinkPlugin(): Plugin<WikiTrigger | null> {
  return new Plugin<WikiTrigger | null>({
    key: wikiLinkKey,
    state: {
      init: (_config, state) => detect(state),
      apply: (_tr, _value, _oldState, newState) => detect(newState),
    },
  })
}
