// SPDX-License-Identifier: MIT WITH Commons-Clause
// Locked-garden state for the web client.
//
// An encrypted garden only exists in the server's memory while it is unlocked,
// so a restart (an update, a reboot) leaves the active garden locked: every
// request answers 423 UNLOCK_REQUIRED until a passphrase is supplied. Before
// this store existed that surfaced as a raw "500: UNLOCK_REQUIRED:default" with
// no way forward.
//
// Unlike the session-expiry store there is nothing to second-guess here: 423
// with that code is the server stating the garden is locked, so the first one
// we see opens the prompt.

import { create } from 'zustand'
import { isDemoMode, onGardenLocked } from '../lib/api'

interface GardenLockState {
  /** Id of the garden awaiting a passphrase, or null when nothing is locked. */
  lockedGardenId: string | null
  /** An unlock attempt is in flight. */
  unlocking: boolean
  /** Why the last attempt failed, for the dialog to show. */
  error: string | null

  markLocked: (gardenId: string) => void
  /** Send the passphrase; on success reload the app against the open garden. */
  unlock: (passphrase: string) => Promise<void>
}

export const useGardenLockStore = create<GardenLockState>()((set, get) => ({
  lockedGardenId: null,
  unlocking: false,
  error: null,

  markLocked: (gardenId) => {
    if (isDemoMode) return
    if (get().lockedGardenId === gardenId) return
    set({ lockedGardenId: gardenId, error: null })
  },

  unlock: async (passphrase) => {
    const id = get().lockedGardenId
    if (!id || !passphrase) return

    set({ unlocking: true, error: null })
    try {
      // Raw fetch, not the api helper: this endpoint answers a wrong passphrase
      // with 401, which has nothing to do with the proxy session, so it must
      // not go through the auth-expiry check.
      const res = await fetch('/api/v1/gardens/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, passphrase }),
      })

      if (!res.ok) {
        if (res.status === 401) throw new Error('Invalid passphrase')
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to unlock garden')
      }

      // Re-run the app's startup against the now-open garden rather than
      // patching every store back to life by hand. A full navigation (as the
      // auth store uses) rather than location.reload(), which can be served
      // from the back/forward or service-worker cache; keeping the current URL
      // means a deep link survives the unlock.
      window.location.assign(window.location.href)
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to unlock garden' })
    } finally {
      set({ unlocking: false })
    }
  },
}))

onGardenLocked((gardenId) => {
  useGardenLockStore.getState().markLocked(gardenId)
})
