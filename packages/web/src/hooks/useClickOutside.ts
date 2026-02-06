// SPDX-License-Identifier: MIT WITH Commons-Clause
// Hook for detecting clicks outside a referenced element

import { useEffect, type RefObject } from 'react'

/**
 * Calls onClose when a click occurs outside the referenced element.
 * Uses mousedown event to close before focus changes.
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void
) {
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [ref, onClose])
}
