// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Code-highlighting LAYER for Editor V2 — a standalone ProseMirror plugin that
// adds decorations to fenced code blocks. Unplug it and code blocks fall back to
// plain markdown text (the tree still works). Uses lowlight (highlight.js) and
// emits the same .hljs-* classes V1's syntax CSS already styles.

import { Plugin } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { Node as PMNode } from 'prosemirror-model'
import { createLowlight } from 'lowlight'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import go from 'highlight.js/lib/languages/go'
import json from 'highlight.js/lib/languages/json'
import yaml from 'highlight.js/lib/languages/yaml'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import html from 'highlight.js/lib/languages/xml'
import markdown from 'highlight.js/lib/languages/markdown'
import sql from 'highlight.js/lib/languages/sql'

const lowlight = createLowlight()
lowlight.register('javascript', javascript); lowlight.register('js', javascript)
lowlight.register('typescript', typescript); lowlight.register('ts', typescript)
lowlight.register('python', python); lowlight.register('py', python)
lowlight.register('rust', rust); lowlight.register('rs', rust)
lowlight.register('go', go); lowlight.register('golang', go)
lowlight.register('json', json)
lowlight.register('yaml', yaml); lowlight.register('yml', yaml)
lowlight.register('bash', bash); lowlight.register('sh', bash); lowlight.register('shell', bash)
lowlight.register('css', css)
lowlight.register('html', html); lowlight.register('xml', html)
lowlight.register('markdown', markdown); lowlight.register('md', markdown)
lowlight.register('sql', sql)

// A block whose content is a single fenced code block: ```lang\n code \n```
const FENCE = /^```([\w+#-]*)\r?\n([\s\S]*?)\r?\n```$/

interface Span { from: number; to: number; cls: string }

function highlightSpans(code: string, language: string): Span[] {
  const spans: Span[] = []
  let tree
  try {
    tree = language && lowlight.registered(language) ? lowlight.highlight(language, code) : lowlight.highlightAuto(code)
  } catch {
    return spans
  }
  let pos = 0
  const walk = (node: any) => {
    if (node.type === 'text') {
      pos += node.value.length
      return
    }
    if (node.type === 'element') {
      const start = pos
      node.children?.forEach(walk)
      const end = pos
      const cn = node.properties?.className
      const cls = Array.isArray(cn) ? cn.join(' ') : cn
      if (cls && end > start) spans.push({ from: start, to: end, cls })
      return
    }
    node.children?.forEach(walk)
  }
  tree.children.forEach(walk)
  return spans
}

// True when a line node's text is a fenced code block (so the formatting layer
// can skip it — see decorations.ts).
export function isCodeFenceText(text: string): boolean {
  return FENCE.test(text)
}

function build(doc: PMNode): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'line') return
    const text = node.textContent
    const m = text.match(FENCE)
    if (!m) return
    decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'pm-codeblock' }))
    const base = pos + 1
    const codeStart = text.indexOf('\n') + 1 // offset of code after the ```lang line
    for (const s of highlightSpans(m[2], m[1])) {
      decos.push(Decoration.inline(base + codeStart + s.from, base + codeStart + s.to, { class: s.cls }))
    }
  })
  return DecorationSet.create(doc, decos)
}

export function codeHighlightPlugin(): Plugin {
  return new Plugin({
    state: {
      init: (_c, state) => build(state.doc),
      apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
    },
    props: {
      decorations(state) {
        return this.getState(state)
      },
    },
  })
}
