// SPDX-License-Identifier: MIT WITH Commons-Clause
import { useState } from 'react'
import { useAuthStore } from '../../stores/authStore'

/**
 * Blocking dialog shown when the reverse proxy's session has expired.
 *
 * Deliberately not dismissable: every request is failing at this point, so
 * dismissing it would just return the user to a UI that silently does nothing.
 */
export function SessionExpiredOverlay() {
  const sessionExpired = useAuthStore((state) => state.sessionExpired)
  const reauthenticate = useAuthStore((state) => state.reauthenticate)
  const [signingIn, setSigningIn] = useState(false)

  if (!sessionExpired) return null

  const handleSignIn = () => {
    setSigningIn(true)
    void reauthenticate()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="overlay-backdrop fixed inset-0 bg-black/50 animate-fade-in" />
      <div className="overlay-content relative bg-base-01 rounded-lg shadow-2xl border border-base-02 p-6 max-w-md w-full mx-4">
        <h2 className="text-lg font-medium text-base-06 mb-2">
          Session expired
        </h2>
        <p className="text-sm text-base-04 mb-4">
          You've been signed out, so Tend can't reach the server. Sign in again
          to keep working.
        </p>
        <p className="text-sm text-base-03 mb-6">
          Unsaved changes on this page are kept on this device and offered back
          after you sign in.
        </p>
        <div className="flex justify-end">
          <button
            onClick={handleSignIn}
            disabled={signingIn}
            autoFocus
            className="px-4 py-2 text-sm bg-base-0D text-base-00 rounded hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {signingIn ? 'Signing in…' : 'Sign in again'}
          </button>
        </div>
      </div>
    </div>
  )
}
