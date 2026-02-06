// SPDX-License-Identifier: MIT WITH Commons-Clause
// Hook for handling Escape key press to close popups

import { useEffect } from 'react'

/**
 * Calls onClose when the Escape key is pressed.
 */
export function useEscapeKey(onClose: () => void) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])
}
