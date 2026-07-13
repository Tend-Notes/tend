// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Editor V2: one ProseMirror EditorView for the whole page. The document is the
// block tree (see schema.ts). This is the MVP mount — render + editable text +
// debounced save round-trip. Structural commands, inline decorations, and the
// full command surface land in follow-up commits.

import { useEffect, useRef, useState } from 'react'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import type { Block, Page } from '../../../types'
import { usePageStore } from '../../../stores/pageStore'
import { useUIStore } from '../../../stores/uiStore'
import { useSelectionStore } from '../../../stores/selectionStore'
import { pageToDoc, docToBlocks } from './pageDoc'
import { focusBlock, blockUuidAtSelection } from './pmUtil'
import { hasFinePointer } from '../../../lib/pointer'
import { textLayer, outlinerLayer, formattingLayer, slashMenuLayer, composeLayers } from './layers'
import { slashMenuKey, type SlashTrigger } from './slashMenuPlugin'
import { wikiLinkKey, type WikiTrigger } from './wikiLinkPlugin'
import { SlashMenu } from './SlashMenu'
import { WikiLinkPopup } from '../WikiLinkPopup'
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

  // Slash-command menu trigger, lifted from the plugin state on each transaction.
  const [slashTrigger, setSlashTrigger] = useState<SlashTrigger | null>(null)
  const setSlashTriggerRef = useRef(setSlashTrigger)
  setSlashTriggerRef.current = setSlashTrigger

  // `[[` wiki-link menu trigger, same lift-from-plugin pattern. `wikiDismissedFrom`
  // remembers a trigger the user Escaped so it doesn't immediately reopen.
  const [wikiTrigger, setWikiTrigger] = useState<WikiTrigger | null>(null)
  const setWikiTriggerRef = useRef(setWikiTrigger)
  setWikiTriggerRef.current = setWikiTrigger
  const [wikiDismissedFrom, setWikiDismissedFrom] = useState<number | null>(null)
  useEffect(() => {
    if (!wikiTrigger) setWikiDismissedFrom(null)
  }, [wikiTrigger])

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

    // Compose the functional layers (order = precedence, high → low). Removing
    // or swapping a layer here is the only change needed to change behavior.
    const { plugins, nodeViews } = composeLayers([
      formattingLayer({
        navigateToPage: (name) => usePageStore.getState().navigateToPage(name),
        navigateToJournal: (date) => usePageStore.getState().navigateToJournal(date),
      }),
      slashMenuLayer(),
      outlinerLayer(),
      textLayer(),
    ])

    const state = EditorState.create({ doc: pageToDoc(page), plugins })

    let lastBlockUuid: string | null = null
    const syncFocusedBlock = () => {
      const uuid = blockUuidAtSelection(view.state)
      if (uuid && uuid !== lastBlockUuid) {
        lastBlockUuid = uuid
        useUIStore.getState().setLastFocusedBlockUuid(uuid)
        useSelectionStore.getState().setFocusedBlock(uuid)
      }
    }

    const view = new EditorView(mountRef.current, {
      state,
      editable: () => !readonly,
      nodeViews,
      dispatchTransaction(tr) {
        const next = view.state.apply(tr)
        view.updateState(next)
        if (tr.docChanged) scheduleSave(view)
        if (tr.selectionSet || tr.docChanged) syncFocusedBlock()
        setSlashTriggerRef.current(slashMenuKey.getState(view.state) ?? null)
        setWikiTriggerRef.current(wikiLinkKey.getState(view.state) ?? null)
      },
    })
    viewRef.current = view

    // PERF-22: load the code-fence highlighter lazily and splice it into the
    // running editor via reconfigure, keeping lowlight + highlight.js languages
    // out of the initial chunk. Fenced code renders as plain markdown text until
    // this resolves; viewRef is nulled on unmount so a late resolve is a no-op.
    void import('./codeHighlight').then(({ codeHighlightPlugin }) => {
      const v = viewRef.current
      if (!v) return
      v.updateState(v.state.reconfigure({ plugins: [...v.state.plugins, codeHighlightPlugin()] }))
    })

    // Wire the command surface (downstream feature reconnect):
    // - insert text from the command palette at the caret (or last-focused block)
    const setInsertTextAtCursor = useUIStore.getState().setInsertTextAtCursor
    setInsertTextAtCursor((text: string) => {
      const v = viewRef.current
      if (!v) return
      // The command palette takes DOM focus, but ProseMirror keeps its selection,
      // so insert at that retained caret — NOT the block end. Only when there's no
      // caret inside a block at all (editor never focused) fall back to the last
      // focused block.
      if (!blockUuidAtSelection(v.state)) {
        const uuid = useUIStore.getState().lastFocusedBlockUuid
        if (uuid) focusBlock(v, uuid, 'end')
      }
      v.dispatch(v.state.tr.insertText(text).scrollIntoView())
      v.focus()
    })

    // - honor a pending caret (template {{cursor}}) or scroll target on mount
    requestAnimationFrame(() => {
      const v = viewRef.current
      if (!v) return
      const cursor = usePageStore.getState().consumePendingCursorPosition()
      if (cursor) {
        focusBlock(v, cursor.blockUuid, cursor.offset)
        return
      }
      const scrollTarget = usePageStore.getState().consumePendingScrollTarget()
      if (scrollTarget) {
        focusBlock(v, scrollTarget, 'start')
        const el = v.dom.querySelector(`[data-block-id="${scrollTarget}"]`)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          el.classList.add('block-container--highlight')
          setTimeout(() => el.classList.remove('block-container--highlight'), 2000)
        }
        return
      }
      // Otherwise focus the editor on load so you can start typing (and so the
      // first click lands where you click instead of just focusing — the editor
      // is already focused, so there's no focus transition to eat the click).
      // Skip on touch devices, where it would pop the soft keyboard every load.
      if (!readonly && hasFinePointer()) v.focus()
    })

    return () => {
      if (saveTimer) clearTimeout(saveTimer)
      useUIStore.getState().setInsertTextAtCursor(null)
      view.destroy()
      viewRef.current = null
    }
    // Build the document once per mount. The page-name key on the wrapper remounts
    // on navigation; we intentionally do not re-sync from prop changes (this is the
    // only editor of this page) to avoid clobbering the caret. eslint-disable-next-line
  }, [])

  // `[[` popup: anchored under the caret; selecting inserts a full wiki-link.
  const wikiView = viewRef.current
  let wikiPopup: JSX.Element | null = null
  if (wikiTrigger && wikiView && wikiTrigger.from !== wikiDismissedFrom) {
    const trig = wikiTrigger
    let coords: { left: number; bottom: number } | null = null
    try {
      coords = wikiView.coordsAtPos(trig.from)
    } catch {
      coords = null
    }
    if (coords) {
      wikiPopup = (
        <WikiLinkPopup
          query={trig.query}
          position={{ top: coords.bottom, left: coords.left }}
          onSelect={(pageName) => {
            wikiView.dispatch(
              wikiView.state.tr.insertText(`[[${pageName}]]`, trig.from, trig.to).scrollIntoView()
            )
            wikiView.focus()
          }}
          onClose={() => setWikiDismissedFrom(trig.from)}
        />
      )
    }
  }

  return (
    <>
      <div ref={mountRef} className="outline2" />
      {slashTrigger && viewRef.current && (
        <SlashMenu view={viewRef.current} trigger={slashTrigger} />
      )}
      {wikiPopup}
    </>
  )
}
