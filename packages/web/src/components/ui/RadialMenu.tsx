// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Arc Menu - A floating button that expands into an arc of options.
// Shows a viewport of ~3 items at a time; scroll to reveal more.
// Can be repositioned to any corner by dragging.

import { useState, useRef, useCallback, useEffect } from 'react'

interface RadialMenuItem {
  id: string
  icon: React.ReactNode
  label: string
  onClick: () => void
}

interface RadialMenuProps {
  items: RadialMenuItem[]
  triggerIcon?: React.ReactNode
}

type Corner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'

const STORAGE_KEY = 'tend-radial-menu-corner'

function loadCorner(): Corner {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && ['bottom-right', 'bottom-left', 'top-right', 'top-left'].includes(saved)) {
      return saved as Corner
    }
  } catch {
    // localStorage not available
  }
  return 'bottom-right'
}

function saveCorner(corner: Corner) {
  try {
    localStorage.setItem(STORAGE_KEY, corner)
  } catch {
    // localStorage not available
  }
}

export function RadialMenu({ items, triggerIcon }: RadialMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [corner, setCorner] = useState<Corner>(loadCorner)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [isRepositioning, setIsRepositioning] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const dragStartY = useRef(0)
  const dragStartOffset = useRef(0)
  const velocity = useRef(0)
  const lastY = useRef(0)
  const lastTime = useRef(0)
  const animationFrame = useRef<number>()
  const repositionStart = useRef<{ x: number; y: number } | null>(null)
  const hasDraggedRef = useRef(false) // Track if user actually dragged (vs tap)

  // Sizing - comfortably tappable
  const TRIGGER_SIZE = 68
  const ITEM_SIZE = 64
  const RADIUS = 110
  const ITEM_SPACING = 32 // Degrees between items
  const VISIBLE_ITEMS = 3

  // Position based on corner
  const getCornerStyle = useCallback((): React.CSSProperties => {
    const margin = 20
    const safeBottom = 40

    switch (corner) {
      case 'bottom-right':
        return { right: margin, bottom: safeBottom }
      case 'bottom-left':
        return { left: margin, bottom: safeBottom }
      case 'top-right':
        return { right: margin, top: margin + 50 }
      case 'top-left':
        return { left: margin, top: margin + 50 }
    }
  }, [corner])

  // Base angle for arc - items extend into screen from corner
  const getBaseAngle = useCallback(() => {
    switch (corner) {
      case 'bottom-right': return 180 + 45
      case 'bottom-left': return -45
      case 'top-right': return 180 - 45
      case 'top-left': return 45
    }
  }, [corner])

  // Momentum animation
  useEffect(() => {
    if (!isDragging && Math.abs(velocity.current) > 0.5) {
      const animate = () => {
        velocity.current *= 0.92
        setScrollOffset((prev) => {
          const next = prev + velocity.current
          const maxOffset = (items.length - 1) * ITEM_SPACING
          return Math.max(0, Math.min(maxOffset, next))
        })

        if (Math.abs(velocity.current) > 0.5) {
          animationFrame.current = requestAnimationFrame(animate)
        }
      }
      animationFrame.current = requestAnimationFrame(animate)
    }

    return () => {
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current)
      }
    }
  }, [isDragging, items.length])

  const determineCorner = useCallback((x: number, y: number): Corner => {
    const midX = window.innerWidth / 2
    const midY = window.innerHeight / 2

    if (x > midX) {
      return y > midY ? 'bottom-right' : 'top-right'
    } else {
      return y > midY ? 'bottom-left' : 'top-left'
    }
  }, [])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]
    const target = e.target as HTMLElement

    // Trigger button: track for reposition or toggle
    if (target.closest('[data-trigger]')) {
      repositionStart.current = { x: touch.clientX, y: touch.clientY }
      return
    }

    // Start drag for arc scrolling (including on item buttons - we'll distinguish tap vs drag later)
    if (isOpen) {
      e.preventDefault() // Prevent page scroll immediately
      e.stopPropagation()
      dragStartY.current = touch.clientY
      dragStartOffset.current = scrollOffset
      lastY.current = touch.clientY
      lastTime.current = Date.now()
      velocity.current = 0
      hasDraggedRef.current = false
      setIsDragging(true)
    }
  }, [isOpen, scrollOffset])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]

    if (repositionStart.current) {
      const dx = Math.abs(touch.clientX - repositionStart.current.x)
      const dy = Math.abs(touch.clientY - repositionStart.current.y)
      if (dx > 20 || dy > 20) {
        setIsRepositioning(true)
      }
      return
    }

    if (isDragging) {
      e.preventDefault() // Prevent scroll
      e.stopPropagation()
      // Drag DOWN = scroll forward (natural scroll direction)
      // Convert pixel movement to degree offset (0.5 degrees per pixel)
      const deltaY = touch.clientY - dragStartY.current // Inverted for natural scroll

      // Mark as dragged if moved more than 10px (distinguish tap from drag)
      if (Math.abs(deltaY) > 10) {
        hasDraggedRef.current = true
      }

      const newOffset = dragStartOffset.current + deltaY * 0.5

      const maxOffset = (items.length - 1) * ITEM_SPACING
      setScrollOffset(Math.max(0, Math.min(maxOffset, newOffset)))

      // Calculate velocity in degrees per frame (targeting 60fps = ~16ms)
      const now = Date.now()
      const dt = now - lastTime.current
      if (dt > 0 && dt < 100) { // Ignore stale samples
        const dy = touch.clientY - lastY.current // Inverted for natural scroll
        // Convert pixel velocity to degree velocity
        // dy pixels in dt ms -> degrees per 16ms frame
        velocity.current = (dy * 0.5 * 16) / dt
      }
      lastY.current = touch.clientY
      lastTime.current = now
    }
  }, [isDragging, items.length])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (isRepositioning) {
      const touch = e.changedTouches[0]
      const newCorner = determineCorner(touch.clientX, touch.clientY)
      setCorner(newCorner)
      saveCorner(newCorner)
      setIsRepositioning(false)
      repositionStart.current = null
      return
    }

    if (repositionStart.current) {
      setIsOpen((prev) => !prev)
      repositionStart.current = null
      return
    }

    setIsDragging(false)
  }, [isRepositioning, determineCorner])

  // Close on outside tap
  useEffect(() => {
    const handleTouchOutside = (e: TouchEvent) => {
      if (isOpen && containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('touchstart', handleTouchOutside)
    return () => document.removeEventListener('touchstart', handleTouchOutside)
  }, [isOpen])

  const cornerStyle = getCornerStyle()
  const baseAngle = getBaseAngle()

  return (
    <div
      ref={containerRef}
      className="fixed z-50"
      style={{ ...cornerStyle, touchAction: isOpen ? 'none' : 'auto' }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Arc of items */}
      {isOpen && (
        <div className="absolute" style={{ width: 1, height: 1 }}>
          {items.map((item, index) => {
            const itemAngle = baseAngle + (index * ITEM_SPACING) - scrollOffset
            const angleRad = (itemAngle * Math.PI) / 180

            const x = Math.cos(angleRad) * RADIUS
            const y = Math.sin(angleRad) * RADIUS

            // Fade based on distance from current view center
            const idealOffset = index * ITEM_SPACING
            const distFromView = Math.abs(scrollOffset - idealOffset)
            const fadeRange = VISIBLE_ITEMS * ITEM_SPACING / 2
            const opacity = Math.max(0, 1 - distFromView / fadeRange)

            if (opacity <= 0.1) return null

            return (
              <button
                key={item.id}
                onMouseDown={(e) => e.preventDefault()} // Prevent focus shift from editor
                onTouchStart={(e) => {
                  // Only prevent default if not dragging (allow scroll gesture)
                  if (!isDragging) e.preventDefault()
                }}
                onClick={() => {
                  // Don't fire action if user was dragging to scroll
                  if (hasDraggedRef.current) return
                  item.onClick()
                  setIsOpen(false)
                }}
                className="absolute flex items-center justify-center rounded-full
                  bg-base-01 border-2 border-base-02
                  text-base-05 active:bg-base-02 active:scale-95
                  transition-colors duration-100"
                style={{
                  width: ITEM_SIZE,
                  height: ITEM_SIZE,
                  left: x - ITEM_SIZE / 2 + TRIGGER_SIZE / 2,
                  top: y - ITEM_SIZE / 2 + TRIGGER_SIZE / 2,
                  opacity,
                  transform: `scale(${0.85 + opacity * 0.15})`,
                }}
                title={item.label}
              >
                {item.icon}
              </button>
            )
          })}
        </div>
      )}

      {/* Trigger button */}
      <button
        data-trigger
        className={`flex items-center justify-center rounded-full
          bg-base-01 border-2 border-base-02
          shadow-lg shadow-black/40
          text-base-05 active:bg-base-02 active:scale-95
          transition-all duration-200
          ${isOpen ? 'rotate-45' : ''}`}
        style={{
          width: TRIGGER_SIZE,
          height: TRIGGER_SIZE,
        }}
      >
        {triggerIcon || (
          <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        )}
      </button>

      {/* Reposition indicator */}
      {isRepositioning && (
        <div className="fixed inset-0 bg-black/20 pointer-events-none flex items-center justify-center">
          <div className="text-base-06 text-lg bg-base-01 px-6 py-3 rounded-xl border border-base-02">
            Drag to corner
          </div>
        </div>
      )}
    </div>
  )
}
