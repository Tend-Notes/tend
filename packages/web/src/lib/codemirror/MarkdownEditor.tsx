// SPDX-License-Identifier: MIT WITH Commons-Clause
// React wrapper for CodeMirror 6 with markdown and hidden delimiters

import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react'
import { EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { Strikethrough } from '@lezer/markdown'
import { hideDelimiters } from './hideDelimiters'
import { Highlight } from './highlightExtension'

export interface MarkdownEditorHandle {
  focus: () => void
  getCursorOffset: () => number
  setCursorOffset: (offset: number) => void
  isAtStart: () => boolean
  isAtEnd: () => boolean
  getContent: () => string
  rebuildDecorations: () => void
}

interface MarkdownEditorProps {
  content: string
  onChange?: (content: string) => void
  onBlur?: () => void
  onFocus?: () => void
  onKeyDown?: (event: KeyboardEvent, view: EditorView) => boolean
  onWikiLinkClick?: (pageName: string) => void
  onTagClick?: (tagName: string) => void
  getTagColor?: (tagName: string) => string
  className?: string
  autoFocus?: boolean
  readonly?: boolean
}

// Wikilink pattern for click detection
const WIKILINK_REGEX = /\[\[([^\]]+)\]\]/g

// Tag pattern for click detection
const TAG_REGEX = /(?:^|(?<=\s))#([a-zA-Z][a-zA-Z0-9_-]*)/g


// Custom highlight style for markdown formatting
const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono, monospace)', fontSize: '0.9em', backgroundColor: 'var(--base01, #eee)', padding: '1px 4px', borderRadius: '3px' },
  { tag: tags.link, color: 'var(--base0D, #81a2be)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--base0D, #81a2be)' },
  // Highlight (==text==) - bright highlighter yellow
  { tag: tags.special(tags.content), backgroundColor: 'rgba(255, 230, 0, 0.35)' },
])

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(({
  content,
  onChange,
  onBlur,
  onFocus,
  onKeyDown,
  onWikiLinkClick,
  onTagClick,
  getTagColor,
  className = '',
  autoFocus = false,
  readonly = false,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const contentRef = useRef(content)

  // Track if we're updating from external prop change
  const isExternalUpdate = useRef(false)

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    focus: () => {
      viewRef.current?.focus()
    },
    getCursorOffset: () => {
      const view = viewRef.current
      if (!view) return 0
      return view.state.selection.main.head
    },
    setCursorOffset: (offset: number) => {
      const view = viewRef.current
      if (!view) return
      const clampedOffset = Math.max(0, Math.min(offset, view.state.doc.length))
      view.dispatch({
        selection: { anchor: clampedOffset },
      })
    },
    isAtStart: () => {
      const view = viewRef.current
      if (!view) return true
      return view.state.selection.main.head === 0
    },
    isAtEnd: () => {
      const view = viewRef.current
      if (!view) return true
      return view.state.selection.main.head >= view.state.doc.length
    },
    getContent: () => {
      const view = viewRef.current
      if (!view) return contentRef.current
      return view.state.doc.toString()
    },
    rebuildDecorations: () => {
      const view = viewRef.current
      if (!view) return
      // Dispatch a no-op transaction to trigger decoration rebuild
      // The selection change will cause hideDelimitersPlugin to rebuild
      const pos = view.state.selection.main.head
      view.dispatch({
        selection: { anchor: pos },
      })
    },
  }), [])

  // Create update listener extension
  const createUpdateListener = useCallback(() => {
    return EditorView.updateListener.of((update) => {
      if (update.docChanged && !isExternalUpdate.current) {
        const newContent = update.state.doc.toString()
        contentRef.current = newContent
        onChange?.(newContent)
      }
    })
  }, [onChange])

  // Store click handlers in refs for event handler access
  const onWikiLinkClickRef = useRef(onWikiLinkClick)
  onWikiLinkClickRef.current = onWikiLinkClick
  const onTagClickRef = useRef(onTagClick)
  onTagClickRef.current = onTagClick

  // Create event handlers extension (for blur/focus/click)
  const createEventHandlers = useCallback(() => {
    return EditorView.domEventHandlers({
      blur: () => {
        onBlur?.()
        return false
      },
      focus: () => {
        onFocus?.()
        return false
      },
      click: (event, view) => {
        // Get the position in the document where user clicked
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (pos === null) return false

        const text = view.state.doc.toString()

        // Check for wikilink click
        if (onWikiLinkClickRef.current) {
          WIKILINK_REGEX.lastIndex = 0
          let match
          while ((match = WIKILINK_REGEX.exec(text)) !== null) {
            const from = match.index + 2  // Start after [[
            const to = match.index + match[0].length - 2  // End before ]]
            if (pos >= from && pos <= to) {
              event.preventDefault()
              onWikiLinkClickRef.current(match[1])
              return true
            }
          }
        }

        // Check for tag click
        if (onTagClickRef.current) {
          TAG_REGEX.lastIndex = 0
          let match
          while ((match = TAG_REGEX.exec(text)) !== null) {
            const tagName = match[1]
            const hashPos = text.lastIndexOf('#', match.index + match[0].length)
            const from = hashPos + 1  // Start after #
            const to = hashPos + 1 + tagName.length
            if (pos >= from && pos <= to) {
              event.preventDefault()
              onTagClickRef.current(tagName)
              return true
            }
          }
        }

        return false
      },
    })
  }, [onBlur, onFocus])

  // Store onKeyDown in ref for keymap access
  const onKeyDownRef = useRef(onKeyDown)
  onKeyDownRef.current = onKeyDown

  // Create high-priority keymap that intercepts all keys and delegates to onKeyDown
  const createCustomKeymap = useCallback(() => {
    return Prec.highest(keymap.of([{
      any: (view, event) => {
        if (onKeyDownRef.current) {
          return onKeyDownRef.current(event, view)
        }
        return false
      },
    }]))
  }, [])

  // Initialize editor
  useEffect(() => {
    if (!containerRef.current) return

    const state = EditorState.create({
      doc: content,
      extensions: [
        createCustomKeymap(),  // Highest priority - intercepts before default keymaps
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown({
          extensions: [Strikethrough, Highlight],
        }),
        syntaxHighlighting(markdownHighlightStyle),
        hideDelimiters(),
        createUpdateListener(),
        createEventHandlers(),
        EditorView.lineWrapping,
        EditorView.editable.of(!readonly),
        EditorView.theme({
          '&': {
            fontSize: 'inherit',
            fontFamily: 'inherit',
            lineHeight: 'inherit',
          },
          '&.cm-focused': {
            outline: 'none',
          },
          '.cm-content': {
            padding: '0',
            caretColor: 'var(--base06, #000)',
            fontFamily: 'inherit',
          },
          '.cm-content:focus': {
            outline: 'none',
          },
          '.cm-line': {
            padding: '0',
          },
          '.cm-cursor': {
            borderLeftColor: 'var(--base06, #000)',
          },
          '.cm-scroller': {
            fontFamily: 'inherit',
            lineHeight: 'inherit',
          },
        }),
      ],
    })

    const view = new EditorView({
      state,
      parent: containerRef.current,
    })

    viewRef.current = view

    if (autoFocus) {
      view.focus()
    }

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, []) // Only run on mount

  // Store getTagColor in ref for effect access
  const getTagColorRef = useRef(getTagColor)
  getTagColorRef.current = getTagColor

  // Sync content from props
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    // Only update if content actually differs
    if (content !== contentRef.current) {
      isExternalUpdate.current = true
      contentRef.current = content

      const cursorPos = view.state.selection.main.head

      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: content,
        },
        selection: { anchor: Math.min(cursorPos, content.length) },
      })

      isExternalUpdate.current = false
    }
  }, [content])

  // Apply tag colors after content changes
  useEffect(() => {
    if (!containerRef.current || !getTagColorRef.current) return

    const tagElements = containerRef.current.querySelectorAll('.cm-tag')
    tagElements.forEach((el) => {
      const tagName = el.getAttribute('data-tag')
      if (tagName && getTagColorRef.current) {
        const color = getTagColorRef.current(tagName)
        ;(el as HTMLElement).style.setProperty('--tag-color', color)
      }
    })
  }, [content, getTagColor])

  return (
    <div
      ref={containerRef}
      className={`markdown-editor ${className}`}
    />
  )
})

MarkdownEditor.displayName = 'MarkdownEditor'

export default MarkdownEditor
