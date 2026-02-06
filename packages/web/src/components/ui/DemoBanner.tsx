// SPDX-License-Identifier: MIT WITH Commons-Clause
// Demo mode banner - shows at top of screen in demo mode

import { useState, useEffect } from 'react'
import { getExpiryHours } from '../../lib/demoStore'

export function DemoBanner() {
  const [dismissed, setDismissed] = useState(false)
  const [expiryHours, setExpiryHours] = useState(6)

  useEffect(() => {
    // Load expiry hours from IndexedDB
    getExpiryHours().then(setExpiryHours).catch(() => {
      // Ignore errors, use default
    })
  }, [])

  if (dismissed) {
    return null
  }

  return (
    <div
      className="flex items-center justify-between px-4 py-2 text-sm"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--base0A) 15%, var(--base00))',
        borderBottom: '1px solid color-mix(in srgb, var(--base0A) 30%, transparent)',
        color: 'var(--base0A)',
      }}
    >
      <div className="flex items-center gap-2">
        <svg
          className="w-4 h-4 flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span>
          <strong>Demo Mode</strong> - Your notes are stored in your browser only and expire after{' '}
          {expiryHours} hours of inactivity.
        </span>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="p-1 hover:opacity-70 transition-opacity"
        title="Dismiss"
        aria-label="Dismiss demo banner"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
