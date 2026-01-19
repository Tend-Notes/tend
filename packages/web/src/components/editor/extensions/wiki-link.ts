// SPDX-License-Identifier: MIT WITH Commons-Clause
// Wiki-link extension for TipTap
// Handles [[Page Name]] syntax with autocomplete

import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import Suggestion, { SuggestionOptions } from '@tiptap/suggestion'

export interface WikiLinkOptions {
  HTMLAttributes: Record<string, unknown>
  suggestion: Omit<SuggestionOptions, 'editor'>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikiLink: {
      setWikiLink: (attributes: { pageName: string }) => ReturnType
    }
  }
}

export const WikiLink = Node.create<WikiLinkOptions>({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      suggestion: {
        char: '[[',
        pluginKey: new PluginKey('wikiLinkSuggestion'),
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              {
                type: 'wikiLink',
                attrs: { pageName: props.pageName },
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
          return text === '[['
        },
      },
    }
  },

  addAttributes() {
    return {
      pageName: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-page-name'),
        renderHTML: (attributes) => ({
          'data-page-name': attributes.pageName,
        }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-wiki-link]',
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const pageName = node.attrs.pageName || HTMLAttributes['data-page-name'] || 'undefined'
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-wiki-link': '',
        'data-page-name': pageName,
        class: 'wiki-link',
      }),
      `[[${pageName}]]`,
    ]
  },

  renderText({ node }) {
    return `[[${node.attrs.pageName}]]`
  },

  addCommands() {
    return {
      setWikiLink:
        (attributes) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: attributes,
          })
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      // Close with ]]
      ']]': () => {
        // This is handled by the input rule / suggestion
        return false
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
      // Plugin to detect and convert typed [[text]] to wiki-link nodes
      new Plugin({
        key: new PluginKey('wikiLinkInput'),
        props: {
          handleTextInput: (view, from, to, text) => {
            // Check if we just typed the closing ]]
            if (text === ']') {
              const { state } = view
              const $from = state.doc.resolve(from)
              const textBefore = $from.parent.textBetween(
                Math.max(0, $from.parentOffset - 100),
                $from.parentOffset,
                '\n',
                '\ufffc'
              )

              // Look for [[something pattern
              const match = textBefore.match(/\[\[([^\[\]]+)$/)
              if (match) {
                const pageName = match[1]
                const start = from - match[0].length

                // Check if next char would also be ]
                const nextChar = state.doc.textBetween(to, Math.min(to + 1, state.doc.content.size))
                if (nextChar === ']' || text === ']') {
                  // We have [[ ... ]] pattern - convert to node
                  const node = state.schema.nodes.wikiLink.create({ pageName })

                  // Delete the [[ ... ]] and insert node
                  const tr = state.tr
                    .delete(start, to + 1) // +1 for the ] we're about to type
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

export default WikiLink
