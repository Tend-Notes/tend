// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Longform Mode editor: one ProseMirror EditorView editing a page's single block
// as a flat wall-of-text (see schema.ts). Reuses V2's formatting engine (inline
// markup, wikilinks/tags, code highlighting, task badges) and undo/redo, but
// drops the outliner layer entirely — no bullets, no Tab/indent, no structure.
// Enter just starts a new line; the whole document saves back as one block.

import { useEffect, useRef } from 'react'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import type { Block, Page } from '../../../types'
import { usePageStore } from '../../../stores/pageStore'
import { useUIStore } from '../../../stores/uiStore'
import { useSelectionStore } from '../../../stores/selectionStore'
import { pageToDocFlat, docToBlocksFlat } from './pageDoc'
import { formattingLayer, textLayer, composeLayers } from '../outline2/layers'
// ProseMirror's required base styles — without these Firefox mis-renders the
// contentEditable and shows no caret (Chromium tolerates their absence).
import 'prosemirror-view/style/prosemirror.css'
import '../outline2/outline2.css'
import './longform.css'

interface LongformEditorProps {
  page: Page
  readonly?: boolean
  onBlocksChange?: (blocks: Block[], rootBlocksHint?: string[]) => void
}

const SAVE_DEBOUNCE_MS = 400

export function LongformEditor({ page, readonly = false, onBlocksChange }: LongformEditorProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const updateCurrentPageStore = usePageStore((s) => s.updateCurrentPage)

  // The single block that holds the whole body. Captured once per mount; the
  // conversion command guarantees it exists, but fall back to a fresh id for a
  // blank page so a first save still creates the block.
  const bodyUuidRef = useRef<string>(
    page.rootBlocks.find((u) => page.blocks[u]) ?? crypto.randomUUID()
  )

  const saveRef = useRef<(blocks: Block[], roots: string[]) => void>(() => {})
  saveRef.current = (blocks, roots) => {
    if (onBlocksChange) onBlocksChange(blocks, roots)
    else updateCurrentPageStore(blocks, roots)
  }

  useEffect(() => {
    if (!mountRef.current) return

    let saveTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleSave = (view: EditorView) => {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        const { blocks, rootBlocks } = docToBlocksFlat(view.state.doc, bodyUuidRef.current)
        saveRef.current(blocks, rootBlocks)
      }, SAVE_DEBOUNCE_MS)
    }

    // Formatting (inline markup) + Text (editable markdown + undo). No outliner
    // layer, no slash menu — longform is a flat document.
    const { plugins, nodeViews } = composeLayers([
      formattingLayer({
        navigateToPage: (name) => usePageStore.getState().navigateToPage(name),
        navigateToJournal: (date) => usePageStore.getState().navigateToJournal(date),
      }),
      textLayer(),
    ])

    const state = EditorState.create({ doc: pageToDocFlat(page), plugins })

    const view = new EditorView(mountRef.current, {
      state,
      editable: () => !readonly,
      nodeViews,
      dispatchTransaction(tr) {
        const next = view.state.apply(tr)
        view.updateState(next)
        if (tr.docChanged) scheduleSave(view)
        if (tr.selectionSet || tr.docChanged) {
          // The whole document is one block; keep the command surface pointed at it.
          useUIStore.getState().setLastFocusedBlockUuid(bodyUuidRef.current)
          useSelectionStore.getState().setFocusedBlock(bodyUuidRef.current)
        }
      },
    })
    viewRef.current = view

    // Lazy code-fence highlighter (kept out of the initial chunk), spliced in
    // via reconfigure once loaded — mirrors OutlineEditorV2.
    void import('../outline2/codeHighlight').then(({ codeHighlightPlugin }) => {
      const v = viewRef.current
      if (!v) return
      v.updateState(v.state.reconfigure({ plugins: [...v.state.plugins, codeHighlightPlugin()] }))
    })

    // Command palette inserts at the retained caret (or end if never focused).
    const setInsertTextAtCursor = useUIStore.getState().setInsertTextAtCursor
    setInsertTextAtCursor((text: string) => {
      const v = viewRef.current
      if (!v) return
      v.dispatch(v.state.tr.insertText(text).scrollIntoView())
      v.focus()
    })

    return () => {
      if (saveTimer) clearTimeout(saveTimer)
      useUIStore.getState().setInsertTextAtCursor(null)
      view.destroy()
      viewRef.current = null
    }
    // Build the document once per mount; the page-name/mode key on the wrapper
    // remounts on navigation or mode change. eslint-disable-next-line
  }, [])

  // `outline2` reuses V2's formatting/header/inline paint rules; `longform`
  // overrides the bullet gutter (the flat schema renders no bullets anyway).
  return <div ref={mountRef} className="outline2 longform" />
}
