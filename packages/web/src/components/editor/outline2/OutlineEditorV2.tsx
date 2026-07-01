// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Editor V2: one ProseMirror EditorView for the whole page. The document is the
// block tree (see schema.ts). This is the MVP mount — render + editable text +
// debounced save round-trip. Structural commands, inline decorations, and the
// full command surface land in follow-up commits.

import { useEffect, useRef } from 'react'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { history, undo, redo } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap, chainCommands, deleteSelection, joinBackward } from 'prosemirror-commands'
import { splitListItem, sinkListItem, liftListItem } from 'prosemirror-schema-list'
import type { Block, Page } from '../../../types'
import { usePageStore } from '../../../stores/pageStore'
import { pageToDoc, docToBlocks } from './pageDoc'
import { listItemType } from './schema'
import { uuidPlugin } from './uuidPlugin'
import { formattingPlugin } from './decorations'
// ProseMirror's required base styles — without these Firefox mis-renders the
// contentEditable and shows no caret (Chromium tolerates their absence).
import 'prosemirror-view/style/prosemirror.css'
import './outline2.css'

interface OutlineEditorV2Props {
  page: Page
  readonly?: boolean
  onBlocksChange?: (blocks: Block[], rootBlocksHint?: string[]) => void
}

const SAVE_DEBOUNCE_MS = 400

export function OutlineEditorV2({ page, readonly = false, onBlocksChange }: OutlineEditorV2Props) {
  const mountRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const updateCurrentPageStore = usePageStore((s) => s.updateCurrentPage)

  // Keep the latest save target in a ref so the view's dispatch closure (built
  // once on mount) always calls the current one.
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
        const { blocks, rootBlocks } = docToBlocks(view.state.doc)
        saveRef.current(blocks, rootBlocks)
      }, SAVE_DEBOUNCE_MS)
    }

    const state = EditorState.create({
      doc: pageToDoc(page),
      plugins: [
        history(),
        uuidPlugin(),
        formattingPlugin({
          navigateToPage: (name) => usePageStore.getState().navigateToPage(name),
          navigateToJournal: (date) => usePageStore.getState().navigateToJournal(date),
        }),
        keymap({
          'Mod-z': undo,
          'Mod-y': redo,
          'Shift-Mod-z': redo,
          // Structural outline ops from the tested list library.
          Enter: splitListItem(listItemType),
          Tab: sinkListItem(listItemType),
          'Shift-Tab': liftListItem(listItemType),
          // Merge into the previous block at line start; else default delete.
          Backspace: chainCommands(deleteSelection, joinBackward),
        }),
        keymap(baseKeymap),
      ],
    })

    const view = new EditorView(mountRef.current, {
      state,
      editable: () => !readonly,
      dispatchTransaction(tr) {
        const next = view.state.apply(tr)
        view.updateState(next)
        if (tr.docChanged) scheduleSave(view)
      },
    })
    viewRef.current = view

    return () => {
      if (saveTimer) clearTimeout(saveTimer)
      view.destroy()
      viewRef.current = null
    }
    // Build the document once per mount. The page-name key on the wrapper remounts
    // on navigation; we intentionally do not re-sync from prop changes (this is the
    // only editor of this page) to avoid clobbering the caret. eslint-disable-next-line
  }, [])

  return <div ref={mountRef} className="outline2" />
}
