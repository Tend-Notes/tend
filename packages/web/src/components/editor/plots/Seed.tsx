// SPDX-License-Identifier: MIT WITH Commons-Clause
// Seed: Block content component (CodeMirror-based)
//
// Handles text editing within a single block using CodeMirror.
// Pure text editing - no formatting or decorations.
//
// Seed is responsible for:
// - Text input and editing via CodeMirror
// - Cursor position tracking
// - Detecting boundary events (cursor at start/end) and delegating to Plots
//
// Formatting, syntax highlighting, and decorations are handled by Actions.
// If Actions fails or is unavailable, Seed continues as a plain text editor.

import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState, Prec, type Extension } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import type { Block } from '../../../types'
import { useActions } from './Actions'

// Safe wrapper for Actions - Seed works without formatting if Actions fails
function useSafeActions(): Extension[] {
  try {
    return useActions()
  } catch {
    return []
  }
}

// Placeholder for Actions layer - will handle formatting commands, decorations, etc.
export interface SeedActions {
  renderContent: (content: string) => string
  applyFormat: (format: string, selection: { start: number; end: number }) => string
}

// Events that Seed reports to Plots for tree-level handling
export type SeedBoundaryEvent =
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

export interface SeedHandle {
  focus: () => void
  blur: () => void
  hasFocus: () => boolean
  getContent: () => string
  getCursorOffset: () => number
  setCursorOffset: (offset: number) => void
  setCursorToStart: () => void
  setCursorToEnd: () => void
}

interface SeedProps {
  block: Block
  isSelected: boolean
  onChange: (content: string) => void
  onBoundaryEvent: (event: SeedBoundaryEvent) => void
  onFocus?: () => void
  onBlur?: () => void
  readonly?: boolean
}

/**
 * Base theme for the CodeMirror editor to match Tend's styling.
 */
const baseTheme = EditorView.theme({
  '&': {
    fontSize: 'inherit',
    fontFamily: 'inherit',
    lineHeight: 'inherit',
  },
  '.cm-content': {
    padding: '0',
    caretColor: 'var(--base05, currentColor)',
    fontFamily: 'inherit',
  },
  '.cm-line': {
    padding: '0',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: 'inherit',
    overflow: 'visible',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--base05, currentColor)',
  },
})

export const Seed = forwardRef<SeedHandle, SeedProps>(
  (
    {
      block,
      isSelected: _isSelected, // Reserved for future styling
      onChange,
      onBoundaryEvent,
      onFocus,
      onBlur,
      readonly = false,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const viewRef = useRef<EditorView | null>(null)
    const contentRef = useRef(block.content)

    // Get formatting extensions from Actions (fails gracefully to empty array)
    const actionExtensions = useSafeActions()

    // Track external updates to avoid feedback loops
    const isExternalUpdate = useRef(false)

    // Store callbacks in refs to avoid recreating extensions
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange
    const onBoundaryEventRef = useRef(onBoundaryEvent)
    onBoundaryEventRef.current = onBoundaryEvent
    const onFocusRef = useRef(onFocus)
    onFocusRef.current = onFocus
    const onBlurRef = useRef(onBlur)
    onBlurRef.current = onBlur

    // Expose methods via ref
    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          viewRef.current?.focus()
        },
        blur: () => {
          viewRef.current?.contentDOM.blur()
        },
        hasFocus: () => {
          return viewRef.current?.hasFocus ?? false
        },
        getContent: () => {
          return viewRef.current?.state.doc.toString() ?? contentRef.current
        },
        getCursorOffset: () => {
          const view = viewRef.current
          if (!view) return 0
          return view.state.selection.main.head
        },
        setCursorOffset: (offset: number) => {
          const view = viewRef.current
          if (!view) return
          const clamped = Math.max(0, Math.min(offset, view.state.doc.length))
          view.dispatch({
            selection: { anchor: clamped },
          })
        },
        setCursorToStart: () => {
          const view = viewRef.current
          if (!view) return
          view.dispatch({
            selection: { anchor: 0 },
          })
        },
        setCursorToEnd: () => {
          const view = viewRef.current
          if (!view) return
          view.dispatch({
            selection: { anchor: view.state.doc.length },
          })
        },
      }),
      []
    )

    // Create keymap that intercepts boundary events
    const createBoundaryKeymap = useCallback(() => {
      return Prec.highest(
        keymap.of([
          // Enter - split block
          {
            key: 'Enter',
            run: (view) => {
              onBoundaryEventRef.current({
                type: 'enter',
                cursorOffset: view.state.selection.main.head,
                content: view.state.doc.toString(),
              })
              return true
            },
          },
          // Shift+Enter - insert line break (let CodeMirror handle it)
          {
            key: 'Shift-Enter',
            run: () => false,
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
          // Shift+Arrow Up - extend block selection
          {
            key: 'Shift-ArrowUp',
            run: () => {
              onBoundaryEventRef.current({ type: 'shift-arrow-up' })
              return true
            },
          },
          // Shift+Arrow Down - extend block selection
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
              const pos = view.state.selection.main.head
              const hasSelection = !view.state.selection.main.empty
              if (pos === 0 && !hasSelection) {
                onBoundaryEventRef.current({ type: 'backspace-at-start' })
                return true
              }
              return false
            },
          },
          // Delete at end - merge with next
          {
            key: 'Delete',
            run: (view) => {
              const pos = view.state.selection.main.head
              const hasSelection = !view.state.selection.main.empty
              if (pos === view.state.doc.length && !hasSelection) {
                onBoundaryEventRef.current({ type: 'delete-at-end' })
                return true
              }
              return false
            },
          },
          // Arrow Up - navigate to previous block if on first line
          {
            key: 'ArrowUp',
            run: (view) => {
              const pos = view.state.selection.main.head
              const line = view.state.doc.lineAt(pos)
              if (line.number === 1) {
                onBoundaryEventRef.current({
                  type: 'arrow-up',
                  cursorOffset: pos,
                })
                return true
              }
              return false
            },
          },
          // Arrow Down - navigate to next block if on last line
          {
            key: 'ArrowDown',
            run: (view) => {
              const pos = view.state.selection.main.head
              const line = view.state.doc.lineAt(pos)
              if (line.number === view.state.doc.lines) {
                onBoundaryEventRef.current({
                  type: 'arrow-down',
                  cursorOffset: pos - line.from,
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
              const pos = view.state.selection.main.head
              const hasSelection = !view.state.selection.main.empty
              if (pos === 0 && !hasSelection) {
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
              const pos = view.state.selection.main.head
              const hasSelection = !view.state.selection.main.empty
              if (pos === view.state.doc.length && !hasSelection) {
                onBoundaryEventRef.current({ type: 'arrow-right-at-end' })
                return true
              }
              return false
            },
          },
        ])
      )
    }, [])

    // Create update listener for content changes
    const createUpdateListener = useCallback(() => {
      return EditorView.updateListener.of((update) => {
        if (update.docChanged && !isExternalUpdate.current) {
          const newContent = update.state.doc.toString()
          contentRef.current = newContent
          onChangeRef.current(newContent)
        }
      })
    }, [])

    // Create focus/blur handlers
    const createEventHandlers = useCallback(() => {
      return EditorView.domEventHandlers({
        focus: () => {
          onFocusRef.current?.()
          return false
        },
        blur: () => {
          onBlurRef.current?.()
          return false
        },
      })
    }, [])

    // Initialize editor - only on mount
    useEffect(() => {
      if (!containerRef.current) return

      const state = EditorState.create({
        doc: block.content,
        extensions: [
          createBoundaryKeymap(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          createUpdateListener(),
          createEventHandlers(),
          baseTheme,
          EditorView.lineWrapping,
          EditorView.editable.of(!readonly),
          ...actionExtensions,
        ],
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
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // Sync content from props when it changes externally
    useEffect(() => {
      const view = viewRef.current
      if (!view) return

      if (block.content !== contentRef.current) {
        isExternalUpdate.current = true
        contentRef.current = block.content

        const cursorPos = view.state.selection.main.head

        view.dispatch({
          changes: {
            from: 0,
            to: view.state.doc.length,
            insert: block.content,
          },
          selection: { anchor: Math.min(cursorPos, block.content.length) },
        })

        isExternalUpdate.current = false
      }
    }, [block.content])

    // Handle focus via custom event from Plots
    useEffect(() => {
      const container = containerRef.current
      if (!container) return

      const handleSeedFocus = (e: Event) => {
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

      container.addEventListener('seed-focus', handleSeedFocus)
      return () => container.removeEventListener('seed-focus', handleSeedFocus)
    }, [])

    return (
      <div
        ref={containerRef}
        data-seed-editor
        className={`block-content outline-none min-h-[1.5em] ${
          readonly ? 'cursor-default' : ''
        }`}
      />
    )
  }
)

Seed.displayName = 'Seed'
