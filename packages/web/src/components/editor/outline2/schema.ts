// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// ProseMirror schema for the node-model outline editor (Editor V2). The document
// IS the block tree: a `block` node carries the uuid/collapsed/properties as
// attrs and contains one `line` (its editable content) followed by its child
// `block`s. Bullets/nesting are structure — rendered as non-editable nodeview
// chrome elsewhere — never editable text. Inline formatting stays source-markdown
// styled by a decoration plugin, so a line's text maps 1:1 to Block.content.

import { Schema } from 'prosemirror-model'

export const outlineSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },

    block: {
      attrs: {
        // Default '' keeps the node generatable (schema requires block+); real
        // uuids are assigned on load and in split/merge commands.
        uuid: { default: '' },
        collapsed: { default: false },
        properties: { default: {} },
      },
      content: 'line block*',
      defining: true,
      toDOM(node) {
        return [
          'li',
          {
            'data-block-id': node.attrs.uuid,
            'data-collapsed': node.attrs.collapsed ? 'true' : 'false',
            class: 'block-container',
          },
          0,
        ]
      },
      parseDOM: [
        {
          tag: 'li[data-block-id]',
          getAttrs(dom: HTMLElement) {
            return {
              uuid: dom.getAttribute('data-block-id'),
              collapsed: dom.getAttribute('data-collapsed') === 'true',
            }
          },
        },
      ],
    },

    // A block's own editable content (one logical block of markdown text).
    line: {
      content: 'text*',
      toDOM() {
        return ['div', { class: 'block-content' }, 0]
      },
      parseDOM: [{ tag: 'div.block-content' }],
    },

    text: {},
  },
})
