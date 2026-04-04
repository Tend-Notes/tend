// SPDX-License-Identifier: MIT WITH Commons-Clause
import { useRef, useCallback } from 'react'

const SWIPE_THRESHOLD = 48 // px horizontal to trigger
const VERTICAL_LIMIT = 20  // px vertical movement cancels swipe

interface SwipeHandlers {
  onTouchStart: (e: React.TouchEvent) => void
  onTouchMove: (e: React.TouchEvent) => void
  onTouchEnd: (e: React.TouchEvent) => void
}

export function useBlockSwipe(
  onIndent: () => void,
  onOutdent: () => void,
): SwipeHandlers {
  const startX = useRef(0)
  const startY = useRef(0)
  const swiping = useRef(false)

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) return // ignore multi-touch
    const touch = e.touches[0]
    startX.current = touch.clientX
    startY.current = touch.clientY
    swiping.current = true
  }, [])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!swiping.current) return
    const touch = e.touches[0]
    const dy = Math.abs(touch.clientY - startY.current)
    if (dy > VERTICAL_LIMIT) {
      swiping.current = false
    }
  }, [])

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!swiping.current) return
    swiping.current = false
    const touch = e.changedTouches[0]
    if (!touch) return
    const dx = touch.clientX - startX.current
    if (Math.abs(dx) >= SWIPE_THRESHOLD) {
      if (dx > 0) {
        onIndent()
      } else {
        onOutdent()
      }
    }
  }, [onIndent, onOutdent])

  return { onTouchStart, onTouchMove, onTouchEnd }
}
