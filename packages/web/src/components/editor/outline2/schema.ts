// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// ProseMirror schema for Editor V2, shaped as a list schema so the tested
// prosemirror-schema-list commands (split / sink / lift = Enter / Tab /
// Shift-Tab) apply directly. The document IS the block tree:
//   doc > bullet_list > list_item(uuid, collapsed, properties) > (line, bullet_list?)
// `line` is a block's editable content (source markdown, styled by decorations).
// Bullets/nesting are structure — non-editable chrome — never text.

import { Schema } from 'prosemirror-model'

export const outlineSchema = new Schema({
  nodes: {
    doc: { content: 'bullet_list' },

    bullet_list: {
      content: 'list_item+',
      toDOM() {
        return ['ul', { class: 'block-list' }, 0]
      },
      parseDOM: [{ tag: 'ul' }],
    },

    list_item: {
      attrs: {
        // Default '' keeps the node generatable; the uuid plugin mints real ones
        // for empty/duplicate items after every structural edit.
        uuid: { default: '' },
        collapsed: { default: false },
        properties: { default: {} },
      },
      content: 'line bullet_list?',
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

export const listItemType = outlineSchema.nodes.list_item
export const bulletListType = outlineSchema.nodes.bullet_list
