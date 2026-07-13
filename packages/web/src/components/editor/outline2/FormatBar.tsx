// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Touch-only floating format bar for Editor V2. Desktop formats via Mod-b/i/e
// keybinds; touch devices have no such keys, so on a text selection we float a
// small toolbar over it. Buttons apply the exact same `wrap` command as the
// keybinds. Positioning uses the DOM selection rect (works for any
// contenteditable); the bar is scoped to this editor's ProseMirror node.

import { useEffect, useState, useCallback, useRef } from 'react'
import { EditorView } from 'prosemirror-view'
import { wrap } from './formatKeymap'

function isCoarsePointer(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false
}

export function FormatBar({ view }: { view: EditorView }) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const barRef = useRef<HTMLDivElement>(null)

  const updatePosition = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setVisible(false)
      return
    }
    // Only when the selection lives inside THIS editor's contenteditable.
    if (!view.dom.contains(sel.anchorNode) || !view.dom.contains(sel.focusNode)) {
      setVisible(false)
      return
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    if (rect.width === 0) {
      setVisible(false)
      return
    }
    const barWidth = barRef.current?.offsetWidth || 200
    let left = rect.left + rect.width / 2 - barWidth / 2
    left = Math.max(8, Math.min(left, window.innerWidth - barWidth - 8))
    setPos({ top: Math.max(8, rect.top - 48), left })
    setVisible(true)
  }, [view])

  // Only wire up on touch/coarse-pointer devices — inert on desktop.
  useEffect(() => {
    if (!isCoarsePointer()) return
    const handler = () => requestAnimationFrame(updatePosition)
    document.addEventListener('selectionchange', handler)
    return () => document.removeEventListener('selectionchange', handler)
  }, [updatePosition])

  useEffect(() => {
    if (!visible) return
    const hide = () => setVisible(false)
    window.addEventListener('scroll', hide, { capture: true })
    return () => window.removeEventListener('scroll', hide, { capture: true })
  }, [visible])

  const apply = useCallback(
    (delim: string) => {
      wrap(delim)(view.state, view.dispatch)
      view.focus()
    },
    [view]
  )

  if (!visible) return null

  // preventDefault on pointerdown keeps the editor's selection from collapsing
  // when the button is pressed, so `wrap` applies to the still-selected text.
  const btn = (delim: string, label: string, content: React.ReactNode) => (
    <button onPointerDown={(e) => { e.preventDefault(); apply(delim) }} aria-label={label}>
      {content}
    </button>
  )

  return (
    <div
      ref={barRef}
      className="selection-pill"
      role="toolbar"
      aria-label="Text formatting"
      style={{ position: 'fixed', top: pos.top, left: pos.left }}
    >
      {btn('**', 'Bold', <strong>B</strong>)}
      {btn('*', 'Italic', <em>I</em>)}
      {btn('`', 'Code', <code>{'<>'}</code>)}
      {btn('~~', 'Strikethrough', <s>S</s>)}
      {btn('==', 'Highlight', 'H')}
    </div>
  )
}
