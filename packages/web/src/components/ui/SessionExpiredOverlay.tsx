// SPDX-License-Identifier: MIT WITH Commons-Clause
import { useState } from 'react'
import { useAuthStore } from '../../stores/authStore'

/**
 * Dialog shown when /whoami has confirmed the reverse proxy signed us out.
 *
 * "Keep working" is not decoration. If this dialog ever appears wrongly it
 * would otherwise brick the app, and a wrongly-blocked UI is worse than the
 * spinner this whole path exists to fix. Dismissing stops it reappearing for
 * the rest of the session.
 */
export function SessionExpiredOverlay() {
  const sessionExpired = useAuthStore((state) => state.sessionExpired)
  const reauthenticate = useAuthStore((state) => state.reauthenticate)
  const dismiss = useAuthStore((state) => state.dismiss)
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
        <div className="flex gap-3 justify-end">
          <button
            onClick={dismiss}
            disabled={signingIn}
            className="px-4 py-2 text-sm text-base-04 hover:text-base-05 transition-colors"
          >
            Keep working
          </button>
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
