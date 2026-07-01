// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Inline formatting for Editor V2. Respects the layer split: the parse layer
// (`parseContent` -> tokens with source spans) is reused unchanged; only the
// paint layer is new — it maps token spans to ProseMirror inline/node
// decorations. Formatting stays source-markdown + decorations (one renderer for
// every block), so a line's text maps 1:1 to Block.content.

import { Plugin } from 'prosemirror-state'
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view'
import { Node as PMNode } from 'prosemirror-model'
import { parseContent } from '../contentRenderer'

// CSS class for the styled *content* of each inline token type.
const CONTENT_CLASS: Record<string, string> = {
  bold: 'pm-bold',
  italic: 'pm-italic',
  bolditalic: 'pm-bolditalic',
  strikethrough: 'pm-strike',
  highlight: 'pm-highlight',
  code: 'pm-code',
}

function decorationsForDoc(doc: PMNode): DecorationSet {
  const decos: Decoration[] = []

  doc.descendants((node, pos) => {
    if (node.type.name !== 'line') return
    const text = node.textContent
    if (!text) return
    const base = pos + 1 // first inline position inside the line

    for (const tok of parseContent(text)) {
      const { srcFrom, srcLen, lead, renderedLen } = tok.span
      const from = base + srcFrom
      const to = base + srcFrom + srcLen
      const contentFrom = base + srcFrom + lead
      const contentTo = contentFrom + renderedLen

      switch (tok.type) {
        case 'bold':
        case 'italic':
        case 'bolditalic':
        case 'strikethrough':
        case 'highlight':
        case 'code': {
          decos.push(Decoration.inline(contentFrom, contentTo, { class: CONTENT_CLASS[tok.type] }))
          // Dim the delimiters (the source chars outside the visible content).
          if (contentFrom > from) decos.push(Decoration.inline(from, contentFrom, { class: 'pm-delim' }))
          if (to > contentTo) decos.push(Decoration.inline(contentTo, to, { class: 'pm-delim' }))
          break
        }
        case 'wikilink':
          decos.push(Decoration.inline(from, to, { class: 'wiki-link', 'data-target': tok.target }))
          break
        case 'tag':
          decos.push(Decoration.inline(from, to, { class: 'tag-pill', 'data-tag': tok.name }))
          break
        case 'url':
          decos.push(Decoration.inline(from, to, { class: 'pm-url', 'data-href': tok.url }))
          break
        case 'blockReference':
          decos.push(Decoration.inline(from, to, { class: 'pm-blockref', 'data-ref': tok.uuid }))
          break
        case 'taskStatus':
          decos.push(Decoration.inline(from, contentTo, { class: `pm-task pm-task-${tok.keyword.toLowerCase()}` }))
          break
        case 'headerPrefix':
          decos.push(Decoration.node(pos, pos + node.nodeSize, { class: `pm-h${tok.level}` }))
          decos.push(Decoration.inline(from, to, { class: 'pm-delim' }))
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

// Route a wikilink target the same way Seed does (journals/<date> -> journal).
function navigate(target: string, nav: NavHandlers) {
  if (target.startsWith('journals/')) nav.navigateToJournal(target.slice('journals/'.length))
  else nav.navigateToPage(target)
}

export function formattingPlugin(nav: NavHandlers): Plugin {
  return new Plugin({
    state: {
      init: (_config, state) => decorationsForDoc(state.doc),
      apply: (tr, old) => (tr.docChanged ? decorationsForDoc(tr.doc) : old),
    },
    props: {
      decorations(state) {
        return this.getState(state)
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
