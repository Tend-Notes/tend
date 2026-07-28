// SPDX-License-Identifier: MIT WITH Commons-Clause
// Session/auth state for the web client.
//
// Tend runs behind a reverse proxy (e.g. Authelia) that expires sessions on its
// own schedule. A tab left open for days keeps working until the first request
// after expiry, which comes back as a 401 (or a redirect to the login portal).
// Nothing in the app can renew that session from JavaScript - only a full page
// navigation makes the proxy issue its login redirect - so the job here is to
// notice the expiry and offer that navigation.

import { create } from 'zustand'
import { identity, isDemoMode, onAuthExpired, AuthExpiredError } from '../lib/api'
import { usePageStore } from './pageStore'

interface AuthState {
  /** True once a request has come back looking like an expired session. */
  sessionExpired: boolean
  /** Last time we successfully confirmed the session, epoch ms. */
  lastVerifiedAt: number | null

  markSessionExpired: () => void
  markSessionValid: () => void
  /** Ask the server who we are; flips sessionExpired when auth has lapsed. */
  verifySession: () => Promise<boolean>
  /** Save unsaved work locally, then navigate so the proxy can sign us in. */
  reauthenticate: () => Promise<void>
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  sessionExpired: false,
  lastVerifiedAt: null,

  markSessionExpired: () => {
    // Demo mode has no backend and no auth - never block the UI there.
    if (isDemoMode) return
    if (get().sessionExpired) return
    set({ sessionExpired: true })
  },

  markSessionValid: () => {
    set({ sessionExpired: false, lastVerifiedAt: Date.now() })
  },

  verifySession: async () => {
    if (isDemoMode) return true
    try {
      await identity.whoami()
      get().markSessionValid()
      return true
    } catch (e) {
      if (e instanceof AuthExpiredError) {
        get().markSessionExpired()
        return false
      }
      // Anything else (server down, offline, DNS) is not an auth problem.
      // Leave the session alone rather than throwing up a misleading dialog.
      return true
    }
  },

  reauthenticate: async () => {
    // The server can't take our edits while we're logged out, so put them in
    // IndexedDB. The existing draft recovery prompt offers them back after
    // sign-in.
    try {
      await usePageStore.getState().persistDraftNow()
    } catch {
      // Never block the trip to the login page on a draft write
    }

    // A full navigation - not location.reload(), which can be served from the
    // back/forward or service-worker cache without ever hitting the proxy.
    // This is what gets an installed app (iOS / "save as app") to the login
    // page, where there is no easy hard reload.
    window.location.assign(window.location.href)
  },
}))

// Any API response that looks like an expired session raises the flag. This is
// registered once, at module load, and covers every call site in lib/api.ts.
onAuthExpired(() => {
  useAuthStore.getState().markSessionExpired()
})
