// SPDX-License-Identifier: MIT WITH Commons-Clause
// Mobile toolbar for touch-friendly editing
//
// Provides formatting and navigation controls for mobile/touch devices.
// Two modes:
// - Formatting: Bold, Italic, Highlight, Strikethrough, Wikilink
// - Controls: Sidebar, Search, Command palette
//
// Tab in/out buttons are always visible at the leftmost/rightmost positions.

import { useState, useCallback, useEffect } from 'react'
import { useUIStore } from '../../stores/uiStore'

type ToolbarMode = 'formatting' | 'controls'

/**
 * Find the currently focused editor element or fall back to last focused.
 */
function findActiveEditor(): HTMLElement | null {
  // First try to find a currently focused Seed editor
  const focusedEditor = document.querySelector('[data-seed-editor]:focus-within') ||
    document.activeElement?.closest('[data-seed-editor]')

  if (focusedEditor) {
    return focusedEditor as HTMLElement
  }

  // Fall back to last focused block
  const lastFocusedUuid = useUIStore.getState().lastFocusedBlockUuid
  if (lastFocusedUuid) {
    const blockEl = document.querySelector(`[data-block-id="${lastFocusedUuid}"]`)
    return blockEl?.querySelector('[data-seed-editor]') as HTMLElement | null
  }

  return null
}

/**
 * Apply formatting to the currently focused editor.
 * Dispatches a custom event that Seed listens for.
 */
function applyFormatting(delimiter: string) {
  const editor = findActiveEditor()
  if (!editor) return

  const event = new CustomEvent('seed-format', {
    detail: { delimiter },
    bubbles: false,
  })
  editor.dispatchEvent(event)
}

/**
 * Insert text at the current cursor position.
 */
function insertText(text: string) {
  const insertFn = useUIStore.getState().insertTextAtCursor
  if (insertFn) {
    insertFn(text)
  }
}

/**
 * Dispatch a boundary event (tab/shift-tab) to trigger indent/outdent.
 * This simulates what happens when the user presses Tab/Shift-Tab in the editor.
 */
function dispatchBoundaryEvent(eventType: 'tab' | 'shift-tab') {
  const editor = findActiveEditor()
  if (!editor) return

  const event = new CustomEvent('seed-boundary', {
    detail: { type: eventType },
    bubbles: false,
  })
  editor.dispatchEvent(event)
}

export function MobileToolbar() {
  const [mode, setMode] = useState<ToolbarMode>('formatting')
  const [isVisible, setIsVisible] = useState(false)
  const toggleSidebar = useUIStore((state) => state.toggleSidebar)
  const openSearch = useUIStore((state) => state.openSearch)
  const openCommandPalette = useUIStore((state) => state.openCommandPalette)

  // Detect mobile/touch device or narrow screen (phone/tablet)
  useEffect(() => {
    const checkMobile = () => {
      const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
      const isNarrowScreen = window.innerWidth < 768
      // Show on touch devices OR narrow screens (for responsive testing)
      setIsVisible(isTouchDevice || isNarrowScreen)
    }

    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Add body class when toolbar is visible for proper padding
  useEffect(() => {
    if (isVisible) {
      document.body.classList.add('has-mobile-toolbar')
    } else {
      document.body.classList.remove('has-mobile-toolbar')
    }
    return () => document.body.classList.remove('has-mobile-toolbar')
  }, [isVisible])

  // Formatting handlers
  const handleBold = useCallback(() => applyFormatting('**'), [])
  const handleItalic = useCallback(() => applyFormatting('*'), [])
  const handleHighlight = useCallback(() => applyFormatting('=='), [])
  const handleStrikethrough = useCallback(() => applyFormatting('~~'), [])
  const handleWikilink = useCallback(() => insertText('[[]]'), [])

  // Tab handlers
  const handleTabOut = useCallback(() => dispatchBoundaryEvent('shift-tab'), [])
  const handleTabIn = useCallback(() => dispatchBoundaryEvent('tab'), [])

  if (!isVisible) return null

  return (
    <div className="mobile-toolbar fixed bottom-0 left-0 right-0 z-50 bg-base-01 border-t border-base-02 safe-area-bottom">
      <div className="flex items-center justify-between px-2 py-1">
        {/* Tab out - leftmost */}
        <button
          onClick={handleTabOut}
          className="mobile-toolbar-btn"
          title="Tab out (outdent)"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14V5" />
          </svg>
        </button>

        {/* Mode content - center */}
        <div className="flex-1 flex items-center justify-center gap-1">
          {mode === 'formatting' ? (
            <>
              <button onClick={handleBold} className="mobile-toolbar-btn font-bold" title="Bold">
                B
              </button>
              <button onClick={handleItalic} className="mobile-toolbar-btn italic" title="Italic">
                I
              </button>
              <button onClick={handleStrikethrough} className="mobile-toolbar-btn line-through" title="Strikethrough">
                S
              </button>
              <button onClick={handleHighlight} className="mobile-toolbar-btn" title="Highlight">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
              <button onClick={handleWikilink} className="mobile-toolbar-btn font-mono text-sm" title="Wikilink">
                [[
              </button>
              {/* Mode switch */}
              <button
                onClick={() => setMode('controls')}
                className="mobile-toolbar-btn ml-2 text-base-04"
                title="Switch to controls"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
              </button>
            </>
          ) : (
            <>
              <button onClick={toggleSidebar} className="mobile-toolbar-btn" title="Toggle sidebar">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <button onClick={openSearch} className="mobile-toolbar-btn" title="Search">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
              <button onClick={openCommandPalette} className="mobile-toolbar-btn" title="Command palette">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>
              {/* Mode switch */}
              <button
                onClick={() => setMode('formatting')}
                className="mobile-toolbar-btn ml-2 text-base-04"
                title="Switch to formatting"
              >
                <span className="font-bold">A</span>
              </button>
            </>
          )}
        </div>

        {/* Tab in - rightmost */}
        <button
          onClick={handleTabIn}
          className="mobile-toolbar-btn"
          title="Tab in (indent)"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5v14" />
          </svg>
        </button>
      </div>
    </div>
  )
}
