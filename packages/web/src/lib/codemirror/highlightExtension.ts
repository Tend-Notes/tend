// SPDX-License-Identifier: MIT WITH Commons-Clause
// Custom lezer-markdown extension for ==highlight== syntax

import { MarkdownConfig } from '@lezer/markdown'
import { tags as t } from '@lezer/highlight'

// Delimiter type for highlight marks
const HighlightDelim = { resolve: 'Highlight', mark: 'HighlightMark' }

// Punctuation pattern from lezer-markdown
const Punctuation = /[!"#$%&'()*+,\-.\/:;<=>?@\[\\\]^_`{|}~\xA1\u2010-\u2027]/

/**
 * Markdown extension for ==highlight== syntax.
 * Similar to strikethrough but uses == delimiters.
 */
export const Highlight: MarkdownConfig = {
  defineNodes: [
    {
      name: 'Highlight',
      style: { 'Highlight/...': t.special(t.content) },
    },
    {
      name: 'HighlightMark',
      style: t.processingInstruction,
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
