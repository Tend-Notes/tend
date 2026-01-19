// SPDX-License-Identifier: MIT WITH Commons-Clause
// Block reference extension for TipTap
// Handles ((block-uuid)) syntax with autocomplete

import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import Suggestion, { SuggestionOptions } from '@tiptap/suggestion'

export interface BlockReferenceOptions {
  HTMLAttributes: Record<string, unknown>
  suggestion: Omit<SuggestionOptions, 'editor'>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockReference: {
      setBlockReference: (attributes: { blockId: string; preview: string }) => ReturnType
    }
  }
}

export const BlockReference = Node.create<BlockReferenceOptions>({
  name: 'blockReference',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      suggestion: {
        char: '((',
        pluginKey: new PluginKey('blockReferenceSuggestion'),
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              {
                type: 'blockReference',
                attrs: { blockId: props.blockId, preview: props.preview },
              },
              {
                type: 'text',
                text: ' ',
              },
            ])
            .run()
        },
        allow: ({ state, range }) => {
          const text = state.doc.textBetween(range.from - 2, range.from, '\n', '\n')
          return text === '(('
        },
      },
    }
  },

  addAttributes() {
    return {
      blockId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-block-id'),
        renderHTML: (attributes) => ({
          'data-block-id': attributes.blockId,
        }),
      },
      preview: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-preview'),
        renderHTML: (attributes) => ({
          'data-preview': attributes.preview,
        }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-block-ref]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    // Show a truncated preview of the referenced block
    const preview = HTMLAttributes.preview || HTMLAttributes.blockId
    const displayText = preview.length > 50 ? preview.substring(0, 50) + '...' : preview

    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-block-ref': '',
        class: 'block-ref',
        title: preview,
      }),
      displayText,
    ]
  },

  renderText({ node }) {
    return `((${node.attrs.blockId}))`
  },

  addCommands() {
    return {
      setBlockReference:
        (attributes) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: attributes,
          })
        },
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
      // Plugin to detect and convert typed ((uuid)) to block-ref nodes
      new Plugin({
        key: new PluginKey('blockRefInput'),
        props: {
          handleTextInput: (view, from, to, text) => {
            // Check if we just typed the closing ))
            if (text === ')') {
              const { state } = view
              const $from = state.doc.resolve(from)
              const textBefore = $from.parent.textBetween(
                Math.max(0, $from.parentOffset - 100),
                $from.parentOffset,
                '\n',
                '\ufffc'
              )

              // Look for ((uuid pattern (UUID format)
              const match = textBefore.match(/\(\(([a-f0-9-]{36})$/)
              if (match) {
                const blockId = match[1]
                const start = from - match[0].length

                // Check if next char would also be )
                const nextChar = state.doc.textBetween(to, Math.min(to + 1, state.doc.content.size))
                if (nextChar === ')' || text === ')') {
                  // We have (( uuid )) pattern - convert to node
                  const node = state.schema.nodes.blockReference.create({
                    blockId,
                    preview: blockId, // Will be resolved later
                  })

                  const tr = state.tr
                    .delete(start, to + 1)
                    .insert(start, node)

                  view.dispatch(tr)
                  return true
                }
              }
            }
            return false
          },
        },
      }),
    ]
  },
})

export default BlockReference
