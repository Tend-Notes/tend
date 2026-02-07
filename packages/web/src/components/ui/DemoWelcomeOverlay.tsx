// SPDX-License-Identifier: MIT WITH Commons-Clause
// Welcome overlay shown on first demo session load

import { useState, useEffect } from 'react'

const DISMISSED_KEY = 'tend-demo-welcome-dismissed'

export function DemoWelcomeOverlay() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Only show if not already dismissed this session
    if (!sessionStorage.getItem(DISMISSED_KEY)) {
      setVisible(true)
    }
  }, [])

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISSED_KEY, 'true')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="max-w-lg mx-4 p-6 bg-base-01 border border-base-02 rounded-lg shadow-xl">
        <h1 className="text-xl font-semibold text-base-05 mb-4">
          Welcome to Tend Demo
        </h1>

        <p className="text-base-04 mb-4">
          This is a demo environment for Tend Notes. This site runs entirely in your browser
          using IndexedDB for storage. It does not include the backend server.
        </p>

        <div className="mb-4">
          <h2 className="text-sm font-semibold text-base-05 mb-2">Disabled Features</h2>
          <ul className="text-sm text-base-04 space-y-1 list-disc list-inside">
            <li>Full-text search</li>
            <li>Git backup and version history</li>
            <li>Multiple gardens</li>
            <li>Data import (Logseq, Markdown)</li>
            <li>Encryption</li>
            <li>Real-time sync across devices</li>
          </ul>
        </div>

        <div className="mb-6">
          <h2 className="text-sm font-semibold text-base-05 mb-2">Demo Limitations</h2>
          <ul className="text-sm text-base-04 space-y-1 list-disc list-inside">
            <li>Data stored only in this browser</li>
            <li>Session expires after inactivity (configurable in settings)</li>
            <li>No cloud backup - clearing browser data deletes everything</li>
          </ul>
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleDismiss}
            className="px-4 py-2 bg-base-0D text-base-00 rounded hover:opacity-90 transition-opacity"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
