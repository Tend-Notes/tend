// SPDX-License-Identifier: MIT WITH Commons-Clause
// BlockEditor: CodeMirror 6 wrapper for block content editing
//
// This is the foundational editor component. It handles:
// - Text editing via CodeMirror
// - Cursor and selection management
// - Undo/redo history
// - Boundary events (Enter, Backspace at start, arrow keys at edges)
//
// It does NOT handle:
// - Block hierarchy or navigation between blocks
// - Wiki-links, tags, or other features (those are layered on top)
// - Formatting decoration (added via extensions)

import {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from 'react'
import { EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'

// Boundary events that escape from this editor to the parent Block
export type BoundaryEvent =
  | { type: 'enter'; cursorOffset: number }
  | { type: 'backspace-at-start' }
  | { type: 'delete-at-end' }
  | { type: 'arrow-up'; cursorOffset: number }
  | { type: 'arrow-down'; cursorOffset: number }
  | { type: 'arrow-left-at-start' }
  | { type: 'arrow-right-at-end' }
  | { type: 'tab'; shift: boolean }

export interface BlockEditorHandle {
  focus: () => void
  blur: () => void
  hasFocus: () => boolean
  getContent: () => string
  getCursorOffset: () => number
  setCursorOffset: (offset: number) => void
  setCursorToStart: () => void
  setCursorToEnd: () => void
}

interface BlockEditorProps {
  content: string
  onChange: (content: string) => void
  onBoundaryEvent: (event: BoundaryEvent) => void
  onFocus?: () => void
  onBlur?: () => void
  autoFocus?: boolean
  readonly?: boolean
  placeholder?: string
  className?: string
}

export const BlockEditor = forwardRef<BlockEditorHandle, BlockEditorProps>(
  (
    {
      content,
      onChange,
      onBoundaryEvent,
      onFocus,
      onBlur,
      autoFocus = false,
      readonly = false,
      placeholder: _placeholder,
      className = '',
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const viewRef = useRef<EditorView | null>(null)
    const contentRef = useRef(content)

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
          {
            key: 'Enter',
            run: (view) => {
              onBoundaryEventRef.current({
                type: 'enter',
                cursorOffset: view.state.selection.main.head,
              })
              return true
            },
          },
          {
            key: 'Backspace',
            run: (view) => {
              const pos = view.state.selection.main.head
              const hasSelection = !view.state.selection.main.empty
              if (pos === 0 && !hasSelection) {
                onBoundaryEventRef.current({ type: 'backspace-at-start' })
                return true
              }
              return false // Let default handle it
            },
          },
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
          {
            key: 'ArrowUp',
            run: (view) => {
              // If we're on the first line, emit boundary event
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
          {
            key: 'ArrowDown',
            run: (view) => {
              // If we're on the last line, emit boundary event
              const pos = view.state.selection.main.head
              const line = view.state.doc.lineAt(pos)
              if (line.number === view.state.doc.lines) {
                onBoundaryEventRef.current({
                  type: 'arrow-down',
                  cursorOffset: pos - line.from, // offset within line
                })
                return true
              }
              return false
            },
          },
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
          {
            key: 'Tab',
            run: () => {
              onBoundaryEventRef.current({ type: 'tab', shift: false })
              return true
            },
          },
          {
            key: 'Shift-Tab',
            run: () => {
              onBoundaryEventRef.current({ type: 'tab', shift: true })
              return true
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

    // Initialize editor
    useEffect(() => {
      if (!containerRef.current) return

      const state = EditorState.create({
        doc: content,
        extensions: [
          createBoundaryKeymap(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
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
        // Defer focus to avoid issues during mount
        requestAnimationFrame(() => {
          view.focus()
        })
      }

      return () => {
        view.destroy()
        viewRef.current = null
      }
    }, []) // Only run on mount

    // Sync content from props when it changes externally
    useEffect(() => {
      const view = viewRef.current
      if (!view) return

      // Only update if content actually differs from what we have
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

    return (
      <div
        ref={containerRef}
        className={`block-editor ${className}`}
      />
    )
  }
)

BlockEditor.displayName = 'BlockEditor'

export default BlockEditor
