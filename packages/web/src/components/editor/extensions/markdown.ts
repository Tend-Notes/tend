// SPDX-License-Identifier: MIT WITH Commons-Clause
// Markdown language support for BlockEditor
//
// Provides syntax highlighting for markdown content including:
// - Emphasis (*italic*, **bold**)
// - Strikethrough (~~text~~)
// - Inline code (`code`)
// - Highlight (==text==) - custom extension

import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { Extension } from '@codemirror/state'
import { Strikethrough, type MarkdownConfig } from '@lezer/markdown'

// Custom highlight extension for ==text== syntax
// Modeled after lezer-markdown's Strikethrough
const HighlightDelim = { resolve: 'Highlight', mark: 'HighlightMark' }

const Punctuation = /[!"#$%&'()*+,\-.\/:;<=>?@\[\\\]^_`{|}~\xA1\u2010-\u2027]/

const Highlight: MarkdownConfig = {
  defineNodes: [
    {
      name: 'Highlight',
      style: { 'Highlight/...': tags.special(tags.content) },
    },
    {
      name: 'HighlightMark',
      style: tags.processingInstruction,
    },
  ],
  parseInline: [
    {
      name: 'Highlight',
      parse(cx, next, pos) {
        // Check for == (char code 61 is '=')
        if (next !== 61 || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) {
          return -1
        }

        const before = cx.slice(pos - 1, pos)
        const after = cx.slice(pos + 2, pos + 3)
        const sBefore = /\s|^$/.test(before)
        const sAfter = /\s|^$/.test(after)
        const pBefore = Punctuation.test(before)
        const pAfter = Punctuation.test(after)

        return cx.addDelimiter(
          HighlightDelim,
          pos,
          pos + 2,
          !sAfter && (!pAfter || sBefore || pBefore),
          !sBefore && (!pBefore || sAfter || pAfter)
        )
      },
      after: 'Emphasis',
    },
  ],
}

// Highlight style for markdown formatting
const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  {
    tag: tags.monospace,
    fontFamily: 'var(--font-mono, monospace)',
    fontSize: '0.9em',
    backgroundColor: 'var(--base01, #eee)',
    padding: '1px 4px',
    borderRadius: '3px',
  },
  { tag: tags.link, color: 'var(--base0D, #81a2be)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--base0D, #81a2be)' },
  // Highlight (==text==)
  { tag: tags.special(tags.content), backgroundColor: 'rgba(255, 230, 0, 0.35)' },
])

/**
 * Returns CodeMirror extensions for markdown syntax highlighting.
 * Does NOT include delimiter hiding - that's a separate extension.
 */
export function markdownExtension(): Extension {
  return [
    markdown({
      extensions: [Strikethrough, Highlight],
    }),
    syntaxHighlighting(markdownHighlightStyle),
  ]
}
