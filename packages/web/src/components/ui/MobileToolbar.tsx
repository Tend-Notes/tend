// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Mobile Toolbar - Vertical strip on right edge for formatting actions
// Positions above iOS keyboard accessory bar when keyboard is visible

import { useState, useEffect, useCallback } from 'react'

interface ToolbarItem {
  id: string
  icon: React.ReactNode
  label: string
  onClick: () => void
}

interface MobileToolbarProps {
  items: ToolbarItem[]
}

export function MobileToolbar({ items }: MobileToolbarProps) {
  const [keyboardHeight, setKeyboardHeight] = useState(0)

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

  return (
    <div
      className="fixed right-2 z-50 flex flex-col gap-1 p-1
        bg-base-01 border border-base-02 rounded-lg shadow-lg"
      style={{ bottom: bottomOffset }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onClick={item.onClick}
          className="w-10 h-10 flex items-center justify-center rounded-md
            text-base-05 active:bg-base-02 active:scale-95
            transition-colors duration-100"
          title={item.label}
          aria-label={item.label}
        >
          {item.icon}
        </button>
      ))}
    </div>
  )
}
