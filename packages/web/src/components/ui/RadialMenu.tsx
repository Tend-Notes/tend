// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Arc Menu - A floating button that expands into an arc of options.
// Shows a viewport of ~3 items at a time; spin the arc to reveal more.
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
  const [rotation, setRotation] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [isRepositioning, setIsRepositioning] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const arcRef = useRef<HTMLDivElement>(null)
  const dragStartY = useRef(0)
  const dragStartRotation = useRef(0)
  const velocity = useRef(0)
  const lastY = useRef(0)
  const lastTime = useRef(0)
  const animationFrame = useRef<number>()
  const repositionStart = useRef<{ x: number; y: number } | null>(null)

  // Larger sizes for mobile touch targets
  const TRIGGER_SIZE = 64
  const ITEM_SIZE = 56
  const RADIUS = 100 // Distance from trigger center to item centers
  const ARC_SPAN = 120 // Degrees of arc visible (showing ~3 items)
  const ITEM_SPACING = 40 // Degrees between items

  // Calculate position offsets based on corner
  const getCornerStyle = useCallback(() => {
    const margin = 16
    const safeBottom = 80 // Account for iOS safe area

    switch (corner) {
      case 'bottom-right':
        return { right: margin, bottom: safeBottom, transformOrigin: 'bottom right' }
      case 'bottom-left':
        return { left: margin, bottom: safeBottom, transformOrigin: 'bottom left' }
      case 'top-right':
        return { right: margin, top: margin + 44, transformOrigin: 'top right' } // 44 for status bar
      case 'top-left':
        return { left: margin, top: margin + 44, transformOrigin: 'top left' }
    }
  }, [corner])

  // Calculate base angle for arc based on corner (arc should extend into screen)
  const getBaseAngle = useCallback(() => {
    switch (corner) {
      case 'bottom-right': return 180 // Arc goes up-left
      case 'bottom-left': return 0 // Arc goes up-right
      case 'top-right': return 180 // Arc goes down-left
      case 'top-left': return 0 // Arc goes down-right
    }
  }, [corner])

  // Handle momentum animation after drag release
  useEffect(() => {
    if (!isDragging && Math.abs(velocity.current) > 0.5) {
      const animate = () => {
        velocity.current *= 0.92 // Friction
        setRotation((prev) => {
          const next = prev + velocity.current
          // Clamp rotation to valid range
          const maxRotation = (items.length - 1) * ITEM_SPACING
          return Math.max(0, Math.min(maxRotation, next))
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

  // Determine which corner based on drag end position
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

    // Check if touch is on the trigger button (for repositioning or toggle)
    if (target.closest('[data-trigger]')) {
      repositionStart.current = { x: touch.clientX, y: touch.clientY }
      return
    }

    // Touch on arc area - start rotation drag
    if (isOpen) {
      dragStartY.current = touch.clientY
      dragStartRotation.current = rotation
      lastY.current = touch.clientY
      lastTime.current = Date.now()
      velocity.current = 0
      setIsDragging(true)
    }
  }, [isOpen, rotation])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]

    // Handle trigger repositioning
    if (repositionStart.current) {
      const dx = Math.abs(touch.clientX - repositionStart.current.x)
      const dy = Math.abs(touch.clientY - repositionStart.current.y)
      if (dx > 20 || dy > 20) {
        setIsRepositioning(true)
      }
      return
    }

    // Handle arc rotation
    if (isDragging) {
      const deltaY = dragStartY.current - touch.clientY
      // Invert for bottom corners so dragging up scrolls forward
      const direction = corner.includes('bottom') ? 1 : -1
      const newRotation = dragStartRotation.current + (deltaY * direction * 0.5)

      // Clamp to valid range
      const maxRotation = (items.length - 1) * ITEM_SPACING
      setRotation(Math.max(0, Math.min(maxRotation, newRotation)))

      // Calculate velocity for momentum
      const now = Date.now()
      const dt = now - lastTime.current
      if (dt > 0) {
        const dy = lastY.current - touch.clientY
        velocity.current = (dy * direction * 0.5) / dt * 16
      }
      lastY.current = touch.clientY
      lastTime.current = now
    }
  }, [isDragging, corner, items.length])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    // Handle repositioning completion
    if (isRepositioning) {
      const touch = e.changedTouches[0]
      const newCorner = determineCorner(touch.clientX, touch.clientY)
      setCorner(newCorner)
      saveCorner(newCorner)
      setIsRepositioning(false)
      repositionStart.current = null
      return
    }

    // Handle trigger tap
    if (repositionStart.current) {
      setIsOpen((prev) => !prev)
      repositionStart.current = null
      return
    }

    setIsDragging(false)
  }, [isRepositioning, determineCorner])

  // Close menu when tapping outside
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
      style={cornerStyle}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Arc of items */}
      {isOpen && (
        <div
          ref={arcRef}
          className="absolute"
          style={{
            width: RADIUS * 2 + ITEM_SIZE,
            height: RADIUS * 2 + ITEM_SIZE,
            // Position so trigger is at the corner of this container
            ...(corner === 'bottom-right' && { right: 0, bottom: 0 }),
            ...(corner === 'bottom-left' && { left: 0, bottom: 0 }),
            ...(corner === 'top-right' && { right: 0, top: 0 }),
            ...(corner === 'top-left' && { left: 0, top: 0 }),
          }}
        >
          {items.map((item, index) => {
            // Calculate angle for this item, offset by current rotation
            const itemAngle = baseAngle + (index * ITEM_SPACING) - rotation - (ARC_SPAN / 2) + ITEM_SPACING
            const angleRad = (itemAngle * Math.PI) / 180

            // Position relative to the corner (trigger position)
            const triggerX = corner.includes('right') ? RADIUS + ITEM_SIZE / 2 : RADIUS + ITEM_SIZE / 2
            const triggerY = corner.includes('bottom') ? RADIUS + ITEM_SIZE / 2 : RADIUS + ITEM_SIZE / 2

            const x = triggerX + Math.cos(angleRad) * RADIUS
            const y = triggerY + Math.sin(angleRad) * RADIUS

            // Calculate opacity based on distance from center of viewport
            const normalizedAngle = (index * ITEM_SPACING) - rotation
            const distFromCenter = Math.abs(normalizedAngle)
            const opacity = Math.max(0, 1 - (distFromCenter / (ARC_SPAN / 1.5)))
            const scale = 0.7 + (opacity * 0.3)

            if (opacity <= 0) return null

            return (
              <button
                key={item.id}
                onClick={() => {
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
                  left: x - ITEM_SIZE / 2,
                  top: y - ITEM_SIZE / 2,
                  opacity,
                  transform: `scale(${scale})`,
                  fontSize: '1.25rem',
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
          shadow-lg shadow-black/30
          text-base-05 active:bg-base-02 active:scale-95
          transition-all duration-200
          ${isOpen ? 'rotate-45' : ''}`}
        style={{
          width: TRIGGER_SIZE,
          height: TRIGGER_SIZE,
        }}
      >
        {triggerIcon || (
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
