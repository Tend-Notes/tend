// SPDX-License-Identifier: MIT WITH Commons-Clause
// Actions: CodeMirror-based block content editor
//
// Replaces Seed's contenteditable with CodeMirror for rich text editing.
// Provides markdown formatting with delimiter hiding, syntax highlighting,
// and extensibility for wiki-links, block references, etc.
//
// Actions is responsible for:
// - Text input and editing via CodeMirror
// - Markdown formatting (bold, italic, strikethrough, highlight, code)
// - Cursor position tracking
// - Detecting boundary events and delegating to Plots

import { useRef, useEffect, useCallback } from 'react'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { EditorState, Extension } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import type { Block } from '../../../types'
import { markdownExtension } from '../extensions/markdown'
import { hideDelimiters } from '../extensions/hideDelimiters'

// Events that Actions reports to Plots for tree-level handling
export type ActionsBoundaryEvent =
  | { type: 'enter'; cursorOffset: number; content: string }
  | { type: 'backspace-at-start' }
  | { type: 'delete-at-end' }
  | { type: 'arrow-up'; cursorOffset: number }
  | { type: 'arrow-down'; cursorOffset: number }
  | { type: 'arrow-left-at-start' }
  | { type: 'arrow-right-at-end' }
  | { type: 'tab' }
  | { type: 'shift-tab' }
  | { type: 'alt-arrow-up' }
  | { type: 'alt-arrow-down' }
  | { type: 'shift-arrow-up' }
  | { type: 'shift-arrow-down' }

interface ActionsProps {
  block: Block
  isSelected: boolean
  onChange: (content: string) => void
  onBoundaryEvent: (event: ActionsBoundaryEvent) => void
  readonly?: boolean
  extensions?: Extension[]
}

/**
 * Base theme for the CodeMirror editor to match Tend's styling.
 */
const baseTheme = EditorView.theme({
  '&': {
    fontSize: 'inherit',
    fontFamily: 'inherit',
  },
  '.cm-content': {
    padding: '0',
    caretColor: 'var(--base05, currentColor)',
  },
  '.cm-line': {
    padding: '0',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    overflow: 'visible',
  },
  '.cm-placeholder': {
    color: 'var(--base03, #666)',
    fontStyle: 'italic',
  },
})

export function Actions({
  block,
  isSelected,
  onChange,
  onBoundaryEvent,
  readonly = false,
  extensions: additionalExtensions = [],
}: ActionsProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const contentRef = useRef(block.content)
  const onChangeRef = useRef(onChange)
  const onBoundaryEventRef = useRef(onBoundaryEvent)

  // Keep refs up to date
  useEffect(() => {
    onChangeRef.current = onChange
    onBoundaryEventRef.current = onBoundaryEvent
  }, [onChange, onBoundaryEvent])

  // ─────────────────────────────────────────────────────────────────────────
  // CURSOR HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  const isAtStart = useCallback((view: EditorView): boolean => {
    return view.state.selection.main.head === 0
  }, [])

  const isAtEnd = useCallback((view: EditorView): boolean => {
    return view.state.selection.main.head === view.state.doc.length
  }, [])

  const getCursorOffset = useCallback((view: EditorView): number => {
    return view.state.selection.main.head
  }, [])

  // ─────────────────────────────────────────────────────────────────────────
  // BOUNDARY EVENT KEYMAP
  // ─────────────────────────────────────────────────────────────────────────

  const boundaryKeymap = useCallback(() => {
    return keymap.of([
      // Enter - split block
      {
        key: 'Enter',
        run: (view) => {
          const cursorOffset = getCursorOffset(view)
          const content = view.state.doc.toString()
          onBoundaryEventRef.current({
            type: 'enter',
            cursorOffset,
            content,
          })
          return true
        },
      },
      // Shift+Enter - insert line break (let CodeMirror handle it)
      {
        key: 'Shift-Enter',
        run: () => false, // Let default behavior happen
      },
      // Tab - indent
      {
        key: 'Tab',
        run: () => {
          onBoundaryEventRef.current({ type: 'tab' })
          return true
        },
      },
      // Shift+Tab - outdent
      {
        key: 'Shift-Tab',
        run: () => {
          onBoundaryEventRef.current({ type: 'shift-tab' })
          return true
        },
      },
      // Alt+Arrow Up - move block up
      {
        key: 'Alt-ArrowUp',
        run: () => {
          onBoundaryEventRef.current({ type: 'alt-arrow-up' })
          return true
        },
      },
      // Alt+Arrow Down - move block down
      {
        key: 'Alt-ArrowDown',
        run: () => {
          onBoundaryEventRef.current({ type: 'alt-arrow-down' })
          return true
        },
      },
      // Shift+Arrow Up - extend selection
      {
        key: 'Shift-ArrowUp',
        run: () => {
          onBoundaryEventRef.current({ type: 'shift-arrow-up' })
          return true
        },
      },
      // Shift+Arrow Down - extend selection
      {
        key: 'Shift-ArrowDown',
        run: () => {
          onBoundaryEventRef.current({ type: 'shift-arrow-down' })
          return true
        },
      },
      // Backspace at start - merge with previous
      {
        key: 'Backspace',
        run: (view) => {
          if (view.state.selection.main.empty && isAtStart(view)) {
            onBoundaryEventRef.current({ type: 'backspace-at-start' })
            return true
          }
          return false // Let CodeMirror handle normal backspace
        },
      },
      // Delete at end - merge with next
      {
        key: 'Delete',
        run: (view) => {
          if (view.state.selection.main.empty && isAtEnd(view)) {
            onBoundaryEventRef.current({ type: 'delete-at-end' })
            return true
          }
          return false // Let CodeMirror handle normal delete
        },
      },
      // Arrow Up - navigate to previous block
      {
        key: 'ArrowUp',
        run: (view) => {
          // For single-line content, always navigate
          // For multi-line, only when at start
          const hasLineBreaks = view.state.doc.lines > 1
          if (!hasLineBreaks || isAtStart(view)) {
            onBoundaryEventRef.current({
              type: 'arrow-up',
              cursorOffset: getCursorOffset(view),
            })
            return true
          }
          return false // Let CodeMirror handle within multi-line
        },
      },
      // Arrow Down - navigate to next block
      {
        key: 'ArrowDown',
        run: (view) => {
          const hasLineBreaks = view.state.doc.lines > 1
          if (!hasLineBreaks || isAtEnd(view)) {
            onBoundaryEventRef.current({
              type: 'arrow-down',
              cursorOffset: getCursorOffset(view),
            })
            return true
          }
          return false
        },
      },
      // Arrow Left at start - go to previous block
      {
        key: 'ArrowLeft',
        run: (view) => {
          if (view.state.selection.main.empty && isAtStart(view)) {
            onBoundaryEventRef.current({ type: 'arrow-left-at-start' })
            return true
          }
          return false
        },
      },
      // Arrow Right at end - go to next block
      {
        key: 'ArrowRight',
        run: (view) => {
          if (view.state.selection.main.empty && isAtEnd(view)) {
            onBoundaryEventRef.current({ type: 'arrow-right-at-end' })
            return true
          }
          return false
        },
      },
    ])
  }, [getCursorOffset, isAtStart, isAtEnd])

  // ─────────────────────────────────────────────────────────────────────────
  // EDITOR SETUP
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const newContent = update.state.doc.toString()
        if (newContent !== contentRef.current) {
          contentRef.current = newContent
          onChangeRef.current(newContent)
        }
      }
    })

    const extensions: Extension[] = [
      baseTheme,
      markdownExtension(),
      hideDelimiters(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      boundaryKeymap(),
      updateListener,
      EditorView.lineWrapping,
      placeholder(''),
      ...additionalExtensions,
    ]

    if (readonly) {
      extensions.push(EditorState.readOnly.of(true))
    }

    const state = EditorState.create({
      doc: block.content,
      extensions,
    })

    const view = new EditorView({
      state,
      parent: containerRef.current,
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [readonly, boundaryKeymap, additionalExtensions]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync content when block changes externally
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    if (block.content !== contentRef.current) {
      contentRef.current = block.content
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: block.content,
        },
      })
    }
  }, [block.content])

  // Focus when selected
  useEffect(() => {
    if (isSelected && viewRef.current) {
      viewRef.current.focus()
    }
  }, [isSelected])

  // ─────────────────────────────────────────────────────────────────────────
  // FOCUS EVENT - expose cursor positioning to Plots
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleActionsFocus = (e: Event) => {
      const detail = (e as CustomEvent).detail
      const position = detail?.position
      const view = viewRef.current

      if (!view) return

      view.focus()

      if (position === 'start') {
        view.dispatch({
          selection: { anchor: 0 },
        })
      } else if (position === 'end') {
        view.dispatch({
          selection: { anchor: view.state.doc.length },
        })
      } else if (typeof position === 'number') {
        const pos = Math.min(position, view.state.doc.length)
        view.dispatch({
          selection: { anchor: pos },
        })
      }
    }

    container.addEventListener('actions-focus', handleActionsFocus)
    // Also listen for seed-focus for compatibility during transition
    container.addEventListener('seed-focus', handleActionsFocus)
    return () => {
      container.removeEventListener('actions-focus', handleActionsFocus)
      container.removeEventListener('seed-focus', handleActionsFocus)
    }
  }, [])

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      data-actions-editor
      data-seed-editor // For compatibility during transition
      className={`block-content outline-none min-h-[1.5em] ${
        readonly ? 'cursor-default' : ''
      }`}
    />
  )
}
