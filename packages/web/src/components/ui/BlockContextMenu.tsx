// SPDX-License-Identifier: MIT WITH Commons-Clause
// Block context menu for copying block references

import { useEffect, useRef } from 'react'
import { useToastStore } from '../../stores/toastStore'

interface BlockContextMenuProps {
  x: number
  y: number
  uuid: string
  onClose: () => void
}

export function BlockContextMenu({ x, y, uuid, onClose }: BlockContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const addToast = useToastStore((state) => state.addToast)

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Use capture phase to catch clicks before they propagate
    document.addEventListener('mousedown', handleClick, true)
    return () => document.removeEventListener('mousedown', handleClick, true)
  }, [onClose])

  const handleCopyReference = async () => {
    const reference = `((${uuid}))`
    try {
      await navigator.clipboard.writeText(reference)
      addToast('Block reference copied')
    } catch (err) {
      console.error('Failed to copy block reference:', err)
      addToast('Failed to copy')
    }
    onClose()
  }

  // Adjust position to keep menu on screen
  const style: React.CSSProperties = {
    position: 'fixed',
    left: x,
    top: y,
    zIndex: 1000,
  }

  return (
    <div
      ref={menuRef}
      className="bg-base-01 border border-base-02 rounded-lg shadow-lg py-1 min-w-[180px]"
      style={style}
    >
      <button
        className="w-full px-3 py-1.5 text-left text-sm text-base-05 hover:bg-base-02 transition-colors flex items-center gap-2"
        onClick={handleCopyReference}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
        Copy block reference
      </button>
    </div>
  )
}
