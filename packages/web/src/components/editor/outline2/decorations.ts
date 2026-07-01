// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Inline formatting for Editor V2 (live-preview). Respects the layer split: the
// parse layer (`parseContent` -> tokens with source spans) is reused unchanged;
// only the paint layer is new — it maps token spans to ProseMirror decorations.
// Markdown delimiters are HIDDEN except on the line the caret is in (and only
// when the editor is focused), matching the "source when editing, rendered
// otherwise" behavior.

import { EditorState, Plugin } from 'prosemirror-state'
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view'
import { Node as PMNode } from 'prosemirror-model'
import { parseContent } from '../contentRenderer'
import { useTagStore } from '../../../stores/tagStore'
import { isCodeFenceText } from './codeHighlight'

// Reuse V1's existing formatting classes so styling matches exactly.
const CONTENT_CLASS: Record<string, string> = {
  bold: 'pm-bold',
  italic: 'pm-italic',
  bolditalic: 'pm-bolditalic',
  strikethrough: 'pm-strike',
  highlight: 'fmt-highlight',
  code: 'pm-code',
}
const DELIMITED = new Set(Object.keys(CONTENT_CLASS))

// Position of the `line` node containing the caret, or -1 when the editor is not
// focused (so every line renders as "rendered", delimiters hidden).
function activeLinePos(state: EditorState, focused: boolean): number {
  if (!focused) return -1
  const $h = state.selection.$head
  for (let d = $h.depth; d > 0; d--) {
    if ($h.node(d).type.name === 'line') return $h.before(d)
  }
  return -1
}

function decorationsForDoc(doc: PMNode, activePos: number): DecorationSet {
  const decos: Decoration[] = []

  doc.descendants((node, pos) => {
    if (node.type.name !== 'line') return
    const text = node.textContent
    if (!text) return
    // Fenced code blocks are handled by the code-highlight layer; don't apply
    // inline markdown formatting inside them.
    if (isCodeFenceText(text)) return
    const base = pos + 1
    const active = pos === activePos
    // On the active line show delimiters (dimmed); elsewhere hide them.
    const delimClass = active ? 'pm-delim' : 'pm-hidden'
    const pushDelims = (from: number, contentFrom: number, contentTo: number, to: number) => {
      if (contentFrom > from) decos.push(Decoration.inline(from, contentFrom, { class: delimClass }))
      if (to > contentTo) decos.push(Decoration.inline(contentTo, to, { class: delimClass }))
    }

    for (const tok of parseContent(text)) {
      const { srcFrom, srcLen, lead, renderedLen } = tok.span
      const from = base + srcFrom
      const to = base + srcFrom + srcLen
      const contentFrom = base + srcFrom + lead
      const contentTo = contentFrom + renderedLen

      if (DELIMITED.has(tok.type)) {
        const attrs: Record<string, string> = { class: CONTENT_CLASS[tok.type] }
        // Highlight renders as <mark> (like V1) so the UA default gives reversed
        // (dark) text on the yellow background.
        if (tok.type === 'highlight') attrs.nodeName = 'mark'
        decos.push(Decoration.inline(contentFrom, contentTo, attrs))
        pushDelims(from, contentFrom, contentTo, to)
        continue
      }
      switch (tok.type) {
        case 'wikilink':
          decos.push(Decoration.inline(contentFrom, contentTo, { class: 'wiki-link', 'data-target': tok.target }))
          pushDelims(from, contentFrom, contentTo, to)
          break
        case 'tag': {
          // Set the per-tag color CSS vars the .tag-pill styling reads (same as V1).
          const c = useTagStore.getState().getTagColors(tok.name)
          const style = `--tag-hue:${c.hue};--tag-sat:${c.sat};--tag-textL:${c.textL};--tag-bgL:${c.bgL}`
          decos.push(Decoration.inline(from, to, { class: 'tag-pill', style, 'data-tag': tok.name }))
          break
        }
        case 'url':
          decos.push(Decoration.inline(from, to, { class: 'pm-url', 'data-href': tok.url }))
          break
        case 'blockReference':
          decos.push(Decoration.inline(from, to, { class: 'pm-blockref', 'data-ref': tok.uuid }))
          break
        case 'taskStatus': {
          // Match V1's task-status-badge: keyword color bg, base00 text.
          const cssColor = tok.color.replace('-', '')
          const style = `display:inline-block;padding:1px 6px;margin-right:6px;font-size:0.75em;font-weight:600;border-radius:3px;background-color:var(--${cssColor},#666);color:var(--base00,#fff)`
          decos.push(Decoration.inline(from, contentTo, { class: 'task-status-badge', style }))
          // Hide the trailing space (the badge's margin-right spaces it instead).
          if (to > contentTo) decos.push(Decoration.inline(contentTo, to, { class: delimClass }))
          break
        }
        case 'headerPrefix':
          decos.push(Decoration.node(pos, pos + node.nodeSize, { class: `pm-h${tok.level}` }))
          // Hide the "# " prefix off the active line; dim it on it.
          decos.push(Decoration.inline(from, to, { class: delimClass }))
          break
      }
    }
  })

  return DecorationSet.create(doc, decos)
}

export interface NavHandlers {
  navigateToPage: (name: string) => void
  navigateToJournal: (date: string) => void
}

function navigate(target: string, nav: NavHandlers) {
  if (target.startsWith('journals/')) nav.navigateToJournal(target.slice('journals/'.length))
  else nav.navigateToPage(target)
}

interface FmtState {
  deco: DecorationSet
  focused: boolean
}

export function formattingPlugin(nav: NavHandlers): Plugin<FmtState> {
  return new Plugin<FmtState>({
    state: {
      init: (_config, state) => ({ deco: decorationsForDoc(state.doc, -1), focused: false }),
      apply(tr, prev, _oldState, newState) {
        const focusMeta = tr.getMeta('outline2-focus') as boolean | undefined
        const focused = focusMeta === undefined ? prev.focused : focusMeta
        if (!tr.docChanged && !tr.selectionSet && focusMeta === undefined) {
          return { deco: prev.deco.map(tr.mapping, tr.doc), focused }
        }
        return { deco: decorationsForDoc(newState.doc, activeLinePos(newState, focused)), focused }
      },
    },
    props: {
      decorations(state) {
        return this.getState(state)?.deco
      },
      handleDOMEvents: {
        focus(view) {
          view.dispatch(view.state.tr.setMeta('outline2-focus', true))
          return false
        },
        blur(view) {
          view.dispatch(view.state.tr.setMeta('outline2-focus', false))
          return false
        },
      },
      handleClickOn(_view: EditorView, _pos, _node, _nodePos, event) {
        const el = (event.target as HTMLElement)?.closest?.('[data-target],[data-tag],[data-href]') as HTMLElement | null
        if (!el) return false
        const target = el.getAttribute('data-target')
        const tag = el.getAttribute('data-tag')
        const href = el.getAttribute('data-href')
        if (target) {
          navigate(target, nav)
          return true
        }
        if (tag) {
          nav.navigateToPage(`tags/${tag}`)
          return true
        }
        if (href) {
          window.open(href, '_blank', 'noopener,noreferrer')
          return true
        }
        return false
      },
    },
  })
}
