// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// ProseMirror schema for Longform Mode: a flat wall-of-text. Unlike the V2
// outline (doc > bullet_list > list_item > line), the document is just a stack
// of `line` nodes with no structure, no bullets, no uuids:
//   doc > line+
// One `line` = one hard-wrapped source line of the page's single block. The
// `line`/`text` node specs are shared verbatim with the outline schema so the
// formatting decorations (which key off `line` + `div.block-content`) work
// unchanged here.

import { Schema } from 'prosemirror-model'
import { lineNodeSpec, textNodeSpec } from '../outline2/schema'

export const longformSchema = new Schema({
  nodes: {
    doc: { content: 'line+' },
    line: lineNodeSpec,
    text: textNodeSpec,
  },
})
