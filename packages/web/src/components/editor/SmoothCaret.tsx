// SPDX-License-Identifier: MIT WITH Commons-Clause
// Smooth caret overlay that animates position changes

import { useEffect, useRef, useState, useCallback } from 'react'

interface CaretPosition {
  x: number
  y: number
  height: number
}

interface SmoothCaretProps {
  containerRef: React.RefObject<HTMLElement>
  isActive: boolean
}

export function SmoothCaret({ containerRef, isActive }: SmoothCaretProps) {
  const [position, setPosition] = useState<CaretPosition | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const caretRef = useRef<HTMLDivElement>(null)
  const animationRef = useRef<number | null>(null)

  // Get caret position from current selection
  const updateCaretPosition = useCallback(() => {
    const container = containerRef.current
    if (!container || !isActive) {
      setIsVisible(false)
      return
    }

    const selection = window.getSelection()
    if (!selection || !selection.isCollapsed || selection.rangeCount === 0) {
      setIsVisible(false)
      return
    }

    // Check if selection is within our container
    const range = selection.getRangeAt(0)
    if (!container.contains(range.commonAncestorContainer)) {
      setIsVisible(false)
      return
    }

    // Get the bounding rect of the cursor position
    const rect = range.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()

    // Compute line height for fallback and minimum height
    const computedStyle = window.getComputedStyle(container)
    const lineHeight = parseFloat(computedStyle.lineHeight) || 24

    // Handle empty container or edge cases where range rect is zero
    // This happens when: 1) container is empty, 2) cursor at certain positions
    const isEmpty = container.textContent === ''
    const hasZeroRect = rect.width === 0 && rect.height === 0 && rect.x === 0

    if (isEmpty || hasZeroRect) {
      // Position at start of container
      setPosition({
        x: 0,
        y: 0,
        height: lineHeight,
      })
    } else {
      setPosition({
        x: rect.left - containerRect.left,
        y: rect.top - containerRect.top,
        height: rect.height || lineHeight,
      })
    }

    setIsVisible(true)

    // Reset blink animation on movement
    if (caretRef.current) {
      caretRef.current.style.animation = 'none'
      // Force reflow
      void caretRef.current.offsetHeight
      caretRef.current.style.animation = ''
    }
  }, [containerRef, isActive])

  // Listen for selection changes
  useEffect(() => {
    const handleSelectionChange = () => {
      // Use RAF to batch updates
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
      animationRef.current = requestAnimationFrame(updateCaretPosition)
    }

    document.addEventListener('selectionchange', handleSelectionChange)

    // Also update on input (for immediate feedback)
    const container = containerRef.current
    if (container) {
      container.addEventListener('input', handleSelectionChange)
    }

    // Initial position
    updateCaretPosition()

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
      if (container) {
        container.removeEventListener('input', handleSelectionChange)
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [updateCaretPosition, containerRef])

  // Update when isActive changes
  useEffect(() => {
    updateCaretPosition()
  }, [isActive, updateCaretPosition])

  if (!isVisible || !position) {
    return null
  }

  return (
    <div
      ref={caretRef}
      className="smooth-caret"
      style={{
        transform: `translate(${position.x}px, ${position.y}px)`,
        height: `${position.height}px`,
      }}
    />
  )
}
