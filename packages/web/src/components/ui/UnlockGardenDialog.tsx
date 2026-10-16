// SPDX-License-Identifier: MIT WITH Commons-Clause
// Passphrase prompt for an encrypted garden. Used in two places:
//   - the sidebar's garden switcher, when switching into a locked garden
//   - GardenLockedOverlay, when the active garden is locked at startup
// The second has nowhere to go back to, so it omits onCancel and the dialog
// drops the Cancel button and the click-away/Escape dismissal with it.

import { useState } from 'react'

interface UnlockGardenDialogProps {
  /** Message from a failed attempt, shown above the input. */
  error?: string | null
  /** An attempt is in flight. */
  busy?: boolean
  onSubmit: (passphrase: string) => void
  /** Omit where there is nothing usable behind the dialog. */
  onCancel?: () => void
}

export function UnlockGardenDialog({ error, busy = false, onSubmit, onCancel }: UnlockGardenDialogProps) {
  const [passphrase, setPassphrase] = useState('')

  const submit = () => {
    if (!passphrase || busy) return
    onSubmit(passphrase)
  }

  return (
    <div
      className="fixed inset-0 bg-base-00/80 flex items-center justify-center z-50"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-base-01 border border-base-02 rounded-lg p-4 max-w-sm w-full mx-4 space-y-3"
      >
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-base-0A" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <h3 className="text-sm font-medium text-base-05">Unlock Encrypted Garden</h3>
        </div>
        <p className="text-xs text-base-04">
          This garden is encrypted. Enter your passphrase to unlock it.
        </p>
        {error && (
          <p role="alert" className="text-xs text-base-08">
            {error}
          </p>
        )}
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Passphrase"
          aria-label="Passphrase"
          autoFocus
          className="w-full bg-base-00 border border-base-02 rounded px-2 py-1.5 text-sm text-base-05 focus:outline-none focus:border-base-04"
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') onCancel?.()
          }}
        />
        <div className="flex justify-end gap-2">
          {onCancel && (
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-xs text-base-04 hover:text-base-05 transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            onClick={submit}
            disabled={busy || !passphrase}
            className="px-3 py-1.5 text-xs text-base-00 bg-base-0D hover:bg-base-0D/80 rounded transition-colors disabled:opacity-50"
          >
            {busy ? 'Unlocking...' : 'Unlock'}
          </button>
        </div>
      </div>
    </div>
  )
}
