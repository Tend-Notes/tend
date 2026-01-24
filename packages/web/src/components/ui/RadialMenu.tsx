// SPDX-License-Identifier: MIT WITH Commons-Clause
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

const CORNER_POSITIONS: Record<Corner, { x: string; y: string }> = {
  'bottom-right': { x: 'right-4', y: 'bottom-20' },
  'bottom-left': { x: 'left-4', y: 'bottom-20' },
  'top-right': { x: 'right-4', y: 'top-20' },
  'top-left': { x: 'left-4', y: 'top-20' },
}

export function RadialMenu({ items, triggerIcon }: RadialMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [corner, setCorner] = useState<Corner>('bottom-right')
  const [rotation, setRotation] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [isRepositioning, setIsRepositioning] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const dragStartAngle = useRef(0)
  const lastAngle = useRef(0)
  const velocity = useRef(0)
  const lastTime = useRef(0)
  const animationFrame = useRef<number>()
  const repositionStart = useRef<{ x: number; y: number } | null>(null)

  const RADIUS = 80 // Distance from center to items
  const ITEM_SIZE = 44 // Size of each menu item button
  const TRIGGER_SIZE = 56 // Size of the trigger button

  // Calculate angle from center to a point
  const getAngle = useCallback((clientX: number, clientY: number) => {
    if (!containerRef.current) return 0
    const rect = containerRef.current.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    return Math.atan2(clientY - centerY, clientX - centerX) * (180 / Math.PI)
  }, [])

  // Handle momentum animation
  useEffect(() => {
    if (!isDragging && Math.abs(velocity.current) > 0.5) {
      const animate = () => {
        velocity.current *= 0.95 // Friction
        setRotation((prev) => prev + velocity.current)

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
  }, [isDragging])

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

    // Check if touch is on the trigger button (for repositioning)
    const target = e.target as HTMLElement
    if (target.closest('[data-trigger]')) {
      repositionStart.current = { x: touch.clientX, y: touch.clientY }
      return
    }

    if (!isOpen) return

    dragStartAngle.current = getAngle(touch.clientX, touch.clientY) - rotation
    lastAngle.current = getAngle(touch.clientX, touch.clientY)
    lastTime.current = Date.now()
    velocity.current = 0
    setIsDragging(true)
  }, [isOpen, rotation, getAngle])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]

    // Handle repositioning
    if (repositionStart.current) {
      const dx = Math.abs(touch.clientX - repositionStart.current.x)
      const dy = Math.abs(touch.clientY - repositionStart.current.y)
      if (dx > 20 || dy > 20) {
        setIsRepositioning(true)
      }
      return
    }

    if (!isDragging) return

    const currentAngle = getAngle(touch.clientX, touch.clientY)
    const newRotation = currentAngle - dragStartAngle.current

    // Calculate velocity
    const now = Date.now()
    const dt = now - lastTime.current
    if (dt > 0) {
      let angleDelta = currentAngle - lastAngle.current
      // Handle wrap-around
      if (angleDelta > 180) angleDelta -= 360
      if (angleDelta < -180) angleDelta += 360
      velocity.current = angleDelta / dt * 16 // Normalize to ~60fps
    }

    lastAngle.current = currentAngle
    lastTime.current = now
    setRotation(newRotation)
  }, [isDragging, getAngle])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    // Handle repositioning
    if (isRepositioning) {
      const touch = e.changedTouches[0]
      const newCorner = determineCorner(touch.clientX, touch.clientY)
      setCorner(newCorner)
      setIsRepositioning(false)
      repositionStart.current = null
      return
    }

    if (repositionStart.current) {
      // Was a tap on trigger, toggle menu
      setIsOpen((prev) => !prev)
      repositionStart.current = null
      return
    }

    setIsDragging(false)
  }, [isRepositioning, determineCorner])

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const pos = CORNER_POSITIONS[corner]

  return (
    <div
      ref={containerRef}
      className={`fixed ${pos.x} ${pos.y} z-50`}
      style={{
        width: isOpen ? RADIUS * 2 + ITEM_SIZE : TRIGGER_SIZE,
        height: isOpen ? RADIUS * 2 + ITEM_SIZE : TRIGGER_SIZE,
        transition: isRepositioning ? 'none' : 'width 0.3s ease-out, height 0.3s ease-out',
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Radial items */}
      {isOpen && (
        <div
          className="absolute inset-0"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: isDragging ? 'none' : 'transform 0.1s ease-out',
          }}
        >
          {items.map((item, index) => {
            const angle = (360 / items.length) * index - 90 // Start from top
            const x = Math.cos((angle * Math.PI) / 180) * RADIUS
            const y = Math.sin((angle * Math.PI) / 180) * RADIUS

            return (
              <button
                key={item.id}
                onClick={() => {
                  item.onClick()
                  setIsOpen(false)
                }}
                className="absolute flex items-center justify-center rounded-full
                  bg-base-01/90 backdrop-blur-sm border border-base-02
                  text-base-05 hover:text-base-06 hover:bg-base-02/90
                  active:scale-95 transition-all duration-150"
                style={{
                  width: ITEM_SIZE,
                  height: ITEM_SIZE,
                  left: '50%',
                  top: '50%',
                  transform: `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${-rotation}deg)`,
                }}
                title={item.label}
              >
                {item.icon}
              </button>
            )
          })}
        </div>
      )}

      {/* Center trigger button */}
      <button
        data-trigger
        onClick={() => !isRepositioning && setIsOpen((prev) => !prev)}
        className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
          flex items-center justify-center rounded-full
          bg-base-01/80 backdrop-blur-md border border-base-02/50
          shadow-lg shadow-black/20
          text-base-05 hover:text-base-06 hover:bg-base-02/80
          active:scale-95 transition-all duration-200
          ${isOpen ? 'rotate-45' : ''}`}
        style={{
          width: TRIGGER_SIZE,
          height: TRIGGER_SIZE,
        }}
      >
        {triggerIcon || (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        )}
      </button>

      {/* Reposition indicator */}
      {isRepositioning && (
        <div className="fixed inset-0 bg-black/20 pointer-events-none flex items-center justify-center">
          <div className="text-base-06 text-sm bg-base-01/90 backdrop-blur-sm px-4 py-2 rounded-lg">
            Drag to corner
          </div>
        </div>
      )}
    </div>
  )
}
