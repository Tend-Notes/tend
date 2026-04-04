// SPDX-License-Identifier: MIT WITH Commons-Clause
import { useEffect, useState, useCallback, useRef } from 'react'

interface PillPosition {
  top: number
  left: number
}

function isCoarsePointer() {
  return window.matchMedia('(pointer: coarse)').matches
}

export function SelectionPill() {
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState<PillPosition>({ top: 0, left: 0 })
  const pillRef = useRef<HTMLDivElement>(null)

  const updatePosition = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setVisible(false)
      return
    }

    // Only show within editor blocks
    const anchorEl = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement
    const focusEl = sel.focusNode instanceof Element ? sel.focusNode : sel.focusNode?.parentElement
    const anchorEditor = anchorEl?.closest('[data-seed-editor]')
    const focusEditor = focusEl?.closest('[data-seed-editor]')
    if (!anchorEditor || anchorEditor !== focusEditor) {
      setVisible(false)
      return
    }

    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    if (rect.width === 0) {
      setVisible(false)
      return
    }

    // Use actual pill width after first render, estimate before
    const pillWidth = pillRef.current?.offsetWidth || 180
    let left = rect.left + rect.width / 2 - pillWidth / 2
    left = Math.max(8, Math.min(left, window.innerWidth - pillWidth - 8))
    const top = rect.top - 48

    setPosition({ top: Math.max(8, top), left })
    setVisible(true)
  }, [])

  useEffect(() => {
    if (!isCoarsePointer()) return

    const handler = () => {
      requestAnimationFrame(updatePosition)
    }

    document.addEventListener('selectionchange', handler)
    return () => document.removeEventListener('selectionchange', handler)
  }, [updatePosition])

  // Hide on scroll
  useEffect(() => {
    if (!visible) return
    const hide = () => setVisible(false)
    window.addEventListener('scroll', hide, { capture: true })
    return () => window.removeEventListener('scroll', hide, { capture: true })
  }, [visible])

  const format = useCallback((delimiter: string) => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const anchorEl = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement
    const editor = anchorEl?.closest('[data-seed-editor]')
    if (!editor) return

    const event = new CustomEvent('seed-format', {
      detail: { delimiter },
      bubbles: false,
    })
    editor.dispatchEvent(event)
  }, [])

  if (!visible) return null

  return (
    <div
      ref={pillRef}
      className="selection-pill"
      role="toolbar"
      aria-label="Text formatting"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
      }}
    >
      <button onPointerDown={(e) => { e.preventDefault(); format('**') }} aria-label="Bold">
        <strong>B</strong>
      </button>
      <button onPointerDown={(e) => { e.preventDefault(); format('*') }} aria-label="Italic">
        <em>I</em>
      </button>
      <button onPointerDown={(e) => { e.preventDefault(); format('~~') }} aria-label="Strikethrough">
        <s>S</s>
      </button>
      <button onPointerDown={(e) => { e.preventDefault(); format('==') }} aria-label="Highlight">
        H
      </button>
    </div>
  )
}
