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

import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle, useState, useMemo } from 'react'
import { EditorView, keymap } from '@codemirror/view'
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import type { Block } from '../../../types'
import { useActions } from './Actions'
import { wikilinkStateListener, type WikilinkState } from '../extensions/wikilink'
import { WikilinkSuggestions } from '../extensions/WikilinkSuggestions'
import { slashCommandStateListener, type SlashCommandState } from '../extensions/slashCommand'
import { SlashCommandSuggestions } from '../extensions/SlashCommandSuggestions'
import { codeHighlightExtension } from '../extensions/codeHighlight'

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
  /** Whether this block is code content (between ``` fences, not the fence lines) */
  isCodeBlock?: boolean
  /** Language from the opening code fence (e.g., "js", "rust") */
  codeLanguage?: string
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

/**
 * Extension to configure contenteditable attributes for mobile.
 * Sets inputmode and autocapitalize to optimize for iOS/Android.
 *
 * Note: iOS form accessory bar (prev/next/done) cannot be reliably hidden
 * for contenteditable elements. Apple keeps it visible for accessibility.
 * We optimize other aspects of mobile input instead.
 */
const mobileContentEditable = EditorView.contentAttributes.of({
  // Standard text input mode
  inputmode: 'text',
  // Disable auto-capitalization which can interfere with markdown
  autocapitalize: 'off',
  // Disable autocorrect for code/markdown
  autocorrect: 'off',
  // Disable spellcheck (can be re-enabled in settings if desired)
  spellcheck: 'false',
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
      isCodeBlock = false,
      codeLanguage = '',
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const viewRef = useRef<EditorView | null>(null)
    const contentRef = useRef(block.content)

    // Compartment for dynamically switching between code highlighting and normal formatting
    const contentCompartmentRef = useRef(new Compartment())

    // Code highlighting extension (only for code content blocks)
    const codeHighlighting = useMemo(() => {
      if (!isCodeBlock) return []
      return [codeHighlightExtension(codeLanguage)]
    }, [isCodeBlock, codeLanguage])

    // Track wikilink popup state
    const [wikilinkState, setWikilinkState] = useState<WikilinkState | null>(null)
    const setWikilinkStateRef = useRef(setWikilinkState)

    // Track slash command popup state
    const [slashCommandState, setSlashCommandState] = useState<SlashCommandState | null>(null)
    const setSlashCommandStateRef = useRef(setSlashCommandState)
    setSlashCommandStateRef.current = setSlashCommandState
    setWikilinkStateRef.current = setWikilinkState

    // Get formatting extensions from Actions (fails gracefully to empty array)
    const actionExtensions = useSafeActions()

    // Create wikilink state listener (stable reference via ref)
    const createWikilinkListener = useCallback(() => {
      return wikilinkStateListener((state) => {
        setWikilinkStateRef.current(state)
      })
    }, [])

    // Create slash command state listener
    const createSlashCommandListener = useCallback(() => {
      return slashCommandStateListener((state) => {
        setSlashCommandStateRef.current(state)
      })
    }, [])

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
    // Track code block state for Enter key behavior
    const isCodeBlockRef = useRef(isCodeBlock)
    isCodeBlockRef.current = isCodeBlock

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
          // Enter - split block (or insert newline in code blocks)
          {
            key: 'Enter',
            run: (view) => {
              // In code blocks, Enter inserts newline UNLESS cursor is at very end
              // (after closing ```), in which case exit the code block
              if (isCodeBlockRef.current) {
                const content = view.state.doc.toString()
                const cursorPos = view.state.selection.main.head
                // If cursor is at the very end, exit code block
                if (cursorPos === content.length) {
                  onBoundaryEventRef.current({
                    type: 'enter',
                    cursorOffset: cursorPos,
                    content: content,
                  })
                  return true
                }
                return false // Let CodeMirror handle it (insert newline)
              }
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
          // Tab - indent block (or insert spaces in code blocks)
          {
            key: 'Tab',
            run: (view) => {
              // In code blocks, Tab inserts spaces instead of indenting block
              if (isCodeBlockRef.current) {
                view.dispatch(view.state.replaceSelection('  '))
                return true
              }
              onBoundaryEventRef.current({ type: 'tab' })
              return true
            },
          },
          // Shift+Tab - outdent block (or remove indent in code blocks)
          {
            key: 'Shift-Tab',
            run: (view) => {
              // In code blocks, Shift+Tab removes leading spaces on current line
              if (isCodeBlockRef.current) {
                const { state } = view
                const line = state.doc.lineAt(state.selection.main.head)
                const lineText = line.text
                // Remove up to 2 leading spaces
                if (lineText.startsWith('  ')) {
                  view.dispatch({
                    changes: { from: line.from, to: line.from + 2, insert: '' }
                  })
                } else if (lineText.startsWith(' ')) {
                  view.dispatch({
                    changes: { from: line.from, to: line.from + 1, insert: '' }
                  })
                }
                return true
              }
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

          // Auto-complete code fence: when user types ``` at start of block
          // Expand to ```\n\n``` with cursor positioned to type language
          // Only trigger on insertion (typing), not deletion (backspacing).
          // When backspacing through a code block down to ```, the doc shrinks,
          // so we check that the new doc is longer than the old one.
          const docGrew = update.state.doc.length > update.startState.doc.length
          if (newContent === '```' && docGrew) {
            const view = update.view
            const expandedContent = '```\n\n```'

            // Update content and position cursor after opening ```
            view.dispatch({
              changes: { from: 0, to: newContent.length, insert: expandedContent },
              selection: { anchor: 3 }, // After ```
            })

            contentRef.current = expandedContent
            onChangeRef.current(expandedContent)
            return // Don't fire onChange twice
          }

          contentRef.current = newContent
          onChangeRef.current(newContent)
        }
      })
    }, [])

    // Create typewriter scrolling listener - keeps cursor centered when past middle of viewport
    // Disabled on mobile/touch devices where iOS handles scroll-to-focus natively
    const createTypewriterListener = useCallback(() => {
      return EditorView.updateListener.of((update) => {
        // Skip on mobile - iOS scroll-to-focus conflicts with our scrolling
        const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth < 768
        if (isMobile) return

        // Only trigger on selection changes (cursor movement or typing)
        if (!update.selectionSet && !update.docChanged) return

        const view = update.view
        const pos = view.state.selection.main.head

        // Get cursor coordinates
        const cursorCoords = view.coordsAtPos(pos)
        if (!cursorCoords) return

        // Check if cursor is below the middle of the viewport
        const viewportMiddle = window.innerHeight / 2

        // If cursor is below the middle of the viewport, scroll to center it
        if (cursorCoords.top > viewportMiddle) {
          // Use requestAnimationFrame to avoid layout thrashing
          requestAnimationFrame(() => {
            view.dispatch({
              effects: EditorView.scrollIntoView(pos, { y: 'center' })
            })
          })
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

      // For code blocks, skip normal formatting extensions and use code highlighting
      const contentExtensions = isCodeBlock
        ? codeHighlighting
        : actionExtensions

      const state = EditorState.create({
        doc: block.content,
        extensions: [
          createBoundaryKeymap(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          createUpdateListener(),
          createTypewriterListener(),
          createEventHandlers(),
          createWikilinkListener(),
          createSlashCommandListener(),
          baseTheme,
          mobileContentEditable,
          EditorView.lineWrapping,
          EditorView.editable.of(!readonly),
          // Use compartment for content extensions so they can be reconfigured
          contentCompartmentRef.current.of(contentExtensions),
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

    // Reconfigure content extensions when code block status changes
    useEffect(() => {
      const view = viewRef.current
      if (!view) return

      const contentExtensions = isCodeBlock
        ? codeHighlighting
        : actionExtensions

      view.dispatch({
        effects: contentCompartmentRef.current.reconfigure(contentExtensions),
      })
    }, [isCodeBlock, codeHighlighting, actionExtensions])

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

    // Handle insert text via custom event from Plots
    useEffect(() => {
      const container = containerRef.current
      if (!container) return

      const handleInsertText = (e: Event) => {
        const detail = (e as CustomEvent).detail
        const text = detail?.text
        const view = viewRef.current

        if (!view || !text) return

        // Insert text at current cursor position
        const pos = view.state.selection.main.head
        view.dispatch({
          changes: { from: pos, insert: text },
          selection: { anchor: pos + text.length },
        })

        // Notify onChange
        const newContent = view.state.doc.toString()
        contentRef.current = newContent
        onChangeRef.current(newContent)
      }

      container.addEventListener('seed-insert-text', handleInsertText)
      return () => container.removeEventListener('seed-insert-text', handleInsertText)
    }, [])

    // Handle formatting via custom event from MobileToolbar
    useEffect(() => {
      const container = containerRef.current
      if (!container) return

      const handleFormat = (e: Event) => {
        const detail = (e as CustomEvent).detail
        const delimiter = detail?.delimiter
        const view = viewRef.current

        if (!view || !delimiter) return

        const { from, to } = view.state.selection.main
        const hasSelection = from !== to

        if (hasSelection) {
          // Wrap selection with delimiter
          const selectedText = view.state.sliceDoc(from, to)
          view.dispatch({
            changes: { from, to, insert: `${delimiter}${selectedText}${delimiter}` },
            selection: { anchor: from + delimiter.length, head: to + delimiter.length },
          })
        } else {
          // No selection - insert delimiters and place cursor between them
          view.dispatch({
            changes: { from, to, insert: `${delimiter}${delimiter}` },
            selection: { anchor: from + delimiter.length },
          })
        }

        // Notify onChange
        const newContent = view.state.doc.toString()
        contentRef.current = newContent
        onChangeRef.current(newContent)

        // Focus the editor after formatting
        view.focus()
      }

      container.addEventListener('seed-format', handleFormat)
      return () => container.removeEventListener('seed-format', handleFormat)
    }, [])

    // Handle boundary events (tab/shift-tab) via custom event from MobileToolbar
    useEffect(() => {
      const container = containerRef.current
      if (!container) return

      const handleBoundary = (e: Event) => {
        const detail = (e as CustomEvent).detail
        const eventType = detail?.type

        if (!eventType) return

        // Dispatch the boundary event to Plots via the existing callback
        if (eventType === 'tab') {
          onBoundaryEventRef.current({ type: 'tab' })
        } else if (eventType === 'shift-tab') {
          onBoundaryEventRef.current({ type: 'shift-tab' })
        }
      }

      container.addEventListener('seed-boundary', handleBoundary)
      return () => container.removeEventListener('seed-boundary', handleBoundary)
    }, [])


    return (
      <>
        <div
          ref={containerRef}
          data-seed-editor
          className={`block-content outline-none min-h-[1.5em] ${
            readonly ? 'cursor-default' : ''
          } ${isCodeBlock ? 'code-content' : ''}`}
        />
        {wikilinkState && viewRef.current && (
          <WikilinkSuggestions view={viewRef.current} state={wikilinkState} />
        )}
        {slashCommandState && viewRef.current && (
          <SlashCommandSuggestions view={viewRef.current} state={slashCommandState} />
        )}
      </>
    )
  }
)

Seed.displayName = 'Seed'
