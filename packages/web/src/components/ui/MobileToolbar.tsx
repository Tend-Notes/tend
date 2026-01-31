// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Mobile Toolbar - Vertical strip on right edge for formatting actions
// Collapsed: indent + expand + outdent
// Expanded: all formatting buttons
// Positions above iOS keyboard accessory bar when keyboard is visible

import { useState, useEffect, useCallback } from 'react'

interface ToolbarItem {
  id: string
  icon: React.ReactNode
  label: string
  onClick: () => void
}

interface MobileToolbarProps {
  indentItem: ToolbarItem
  outdentItem: ToolbarItem
  extraItems: ToolbarItem[]
}

export function MobileToolbar({ indentItem, outdentItem, extraItems }: MobileToolbarProps) {
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [expanded, setExpanded] = useState(false)

  // Track keyboard visibility via visualViewport API
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    const handleResize = () => {
      // When keyboard opens, visualViewport.height shrinks
      // The difference from window.innerHeight is roughly keyboard + accessory bar height
      const heightDiff = window.innerHeight - viewport.height
      // Only treat as keyboard if significant height change (> 100px)
      setKeyboardHeight(heightDiff > 100 ? heightDiff : 0)
    }

    viewport.addEventListener('resize', handleResize)
    viewport.addEventListener('scroll', handleResize)

    // Initial check
    handleResize()

    return () => {
      viewport.removeEventListener('resize', handleResize)
      viewport.removeEventListener('scroll', handleResize)
    }
  }, [])

  // Prevent focus shift when tapping buttons
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
  }, [])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
  }, [])

  // Position: right edge, above keyboard when visible, otherwise near bottom
  // Add extra padding (50px) above keyboard for iOS accessory bar
  const bottomOffset = keyboardHeight > 0 ? keyboardHeight + 50 : 80

  const buttonClass = `w-10 h-10 flex items-center justify-center rounded-md
    text-base-05 active:bg-base-02 active:scale-95
    transition-colors duration-100`

  return (
    <div
      className="fixed right-2 z-50 flex flex-col gap-1 p-1
        bg-base-01 border border-base-02 rounded-lg shadow-lg"
      style={{ bottom: bottomOffset }}
    >
      {/* Indent - always visible at top */}
      <button
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onClick={indentItem.onClick}
        className={buttonClass}
        title={indentItem.label}
        aria-label={indentItem.label}
      >
        {indentItem.icon}
      </button>

      {/* Expand/collapse toggle - smaller, suggests "more above/below" */}
      <button
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onClick={() => setExpanded(!expanded)}
        className={`w-10 h-6 flex items-center justify-center rounded-md
          text-base-04 active:bg-base-02 active:scale-95
          transition-colors duration-100 ${expanded ? 'bg-base-02' : ''}`}
        title={expanded ? 'Collapse' : 'More actions'}
        aria-label={expanded ? 'Collapse' : 'More actions'}
      >
        {/* Chevrons up/down with wiggle line between */}
        <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.5}>
          {expanded ? (
            /* Collapse: chevrons pointing inward */
            <>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 5l4 2 4-2" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 11l4-2 4 2" />
            </>
          ) : (
            /* Expand: chevrons pointing outward with wiggle */
            <>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4l4-2 4 2" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8c2-1 4 1 6 0s4 1 6 0" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 12l4 2 4-2" />
            </>
          )}
        </svg>
      </button>

      {/* Extra items - only when expanded */}
      {expanded && extraItems.map((item) => (
        <button
          key={item.id}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onClick={item.onClick}
          className={buttonClass}
          title={item.label}
          aria-label={item.label}
        >
          {item.icon}
        </button>
      ))}

      {/* Outdent - always visible at bottom */}
      <button
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onClick={outdentItem.onClick}
        className={buttonClass}
        title={outdentItem.label}
        aria-label={outdentItem.label}
      >
        {outdentItem.icon}
      </button>
    </div>
  )
}
