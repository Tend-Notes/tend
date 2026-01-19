// SPDX-License-Identifier: MIT WITH Commons-Clause
// Suggestion renderer for TipTap - connects to React

import { ReactRenderer } from '@tiptap/react'
import tippy, { Instance as TippyInstance } from 'tippy.js'
import { SuggestionList, SuggestionListRef, type SuggestionItem } from './suggestion-list'
import { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'

export type { SuggestionItem }

export interface CreateSuggestionRendererOptions {
  getItems: (query: string) => Promise<SuggestionItem[]> | SuggestionItem[]
  onSelect: (item: SuggestionItem) => Record<string, unknown>
}

export function createSuggestionRenderer(options: CreateSuggestionRendererOptions) {
  return {
    items: async ({ query }: { query: string }) => {
      return options.getItems(query)
    },

    render: () => {
      let component: ReactRenderer<SuggestionListRef> | null = null
      let popup: TippyInstance[] | null = null

      return {
        onStart: (props: SuggestionProps) => {
          component = new ReactRenderer(SuggestionList, {
            props: {
              items: props.items,
              command: (item: SuggestionItem) => {
                props.command(options.onSelect(item))
              },
            },
            editor: props.editor,
          })

          if (!props.clientRect) {
            return
          }

          popup = tippy('body', {
            getReferenceClientRect: props.clientRect as () => DOMRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: 'manual',
            placement: 'bottom-start',
          })
        },

        onUpdate: (props: SuggestionProps) => {
          component?.updateProps({
            items: props.items,
            command: (item: SuggestionItem) => {
              props.command(options.onSelect(item))
            },
          })

          if (!props.clientRect) {
            return
          }

          popup?.[0]?.setProps({
            getReferenceClientRect: props.clientRect as () => DOMRect,
          })
        },

        onKeyDown: (props: SuggestionKeyDownProps) => {
          if (props.event.key === 'Escape') {
            popup?.[0]?.hide()
            return true
          }

          return component?.ref?.onKeyDown(props) ?? false
        },

        onExit: () => {
          popup?.[0]?.destroy()
          component?.destroy()
        },
      }
    },
  }
}
