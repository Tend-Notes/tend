// SPDX-License-Identifier: MIT WITH Commons-Clause
// FLIP animation hook for block movements
//
// Uses the FLIP technique (First, Last, Invert, Play) to animate blocks
// smoothly when they move in the tree. This is especially useful for
// large moves (like outdenting) where the visual change is non-obvious.

import { useRef, useCallback, useLayoutEffect } from 'react'

interface BlockPosition {
  top: number
  left: number
  width: number
  height: number
}

interface FlipState {
  positions: Map<string, BlockPosition>
  pendingAnimation: boolean
}

/**
 * Hook that provides FLIP animation for block movements.
 *
 * Usage:
 * 1. Call `capturePositions()` before a state change that will move blocks
 * 2. After React re-renders, `useLayoutEffect` runs the animation
 *
 * The hook automatically detects when blocks have moved and animates them
 * from their old positions to their new positions.
 */
export function useBlockFlip(containerRef: React.RefObject<HTMLDivElement | null>) {
  const stateRef = useRef<FlipState>({
    positions: new Map(),
    pendingAnimation: false,
  })

  /**
   * Capture current positions of all blocks (the "First" in FLIP).
   * Call this BEFORE triggering a state change that will move blocks.
   */
  const capturePositions = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    const positions = new Map<string, BlockPosition>()
    const blockElements = container.querySelectorAll('[data-block-id]')

    blockElements.forEach((el) => {
      const uuid = el.getAttribute('data-block-id')
      if (!uuid) return

      const rect = el.getBoundingClientRect()
      positions.set(uuid, {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      })
    })

    stateRef.current.positions = positions
    stateRef.current.pendingAnimation = true
  }, [containerRef])

  /**
   * Run the FLIP animation after React has re-rendered.
   * This runs in useLayoutEffect to capture positions before paint.
   */
  useLayoutEffect(() => {
    if (!stateRef.current.pendingAnimation) return
    stateRef.current.pendingAnimation = false

    const container = containerRef.current
    if (!container) return

    const oldPositions = stateRef.current.positions
    if (oldPositions.size === 0) return

    const blockElements = container.querySelectorAll('[data-block-id]')
    const animations: Animation[] = []

    blockElements.forEach((el) => {
      const uuid = el.getAttribute('data-block-id')
      if (!uuid) return

      const oldPos = oldPositions.get(uuid)
      if (!oldPos) return // New block, don't animate

      const newRect = el.getBoundingClientRect()

      // Calculate the delta (how much the block moved)
      const deltaX = oldPos.left - newRect.left
      const deltaY = oldPos.top - newRect.top

      // Only animate if there's meaningful movement
      // (threshold of 2px to avoid micro-animations from rounding)
      if (Math.abs(deltaX) < 2 && Math.abs(deltaY) < 2) return

      // Determine animation duration based on distance
      // Larger moves get slightly longer animations for readability
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
      const duration = Math.min(200, Math.max(100, distance * 0.5))

      // Create the animation using Web Animations API
      const animation = el.animate(
        [
          { transform: `translate(${deltaX}px, ${deltaY}px)` },
          { transform: 'translate(0, 0)' },
        ],
        {
          duration,
          easing: 'cubic-bezier(0.33, 1, 0.68, 1)', // ease-out
          fill: 'none',
        }
      )

      animations.push(animation)
    })

    // Clear old positions after animation starts
    stateRef.current.positions = new Map()

    // Clean up animations when they complete
    Promise.all(animations.map((a) => a.finished)).catch(() => {
      // Animation cancelled, no action needed
    })
  })

  return { capturePositions }
}
