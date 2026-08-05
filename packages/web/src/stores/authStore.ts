// SPDX-License-Identifier: MIT WITH Commons-Clause
// Session/auth state for the web client.
//
// Tend runs behind a reverse proxy (e.g. Authelia) that expires sessions on its
// own schedule. A tab left open for days keeps working until the first request
// after expiry, which comes back as a 401 (or a redirect to the login portal).
// Nothing in the app can renew that session from JavaScript - only a full page
// navigation makes the proxy issue its login redirect - so the job here is to
// notice the expiry and offer that navigation.
//
// The hard part is not noticing, it is *not crying wolf*. Blocking the UI on a
// misread response makes the app unusable, which is strictly worse than the
// spinner this was written to fix. So a suspicious response never sets the flag
// on its own: it triggers a /whoami check, and only whoami's answer counts.

import { create } from 'zustand'
import { identity, isDemoMode, onAuthExpired, AuthExpiredError } from '../lib/api'
import { usePageStore } from './pageStore'

interface AuthState {
  /** True once /whoami has confirmed we are signed out. */
  sessionExpired: boolean
  /** Last time we successfully confirmed the session, epoch ms. */
  lastVerifiedAt: number | null

  markSessionValid: () => void
  /**
   * Record an expiry that /whoami itself reported. Only for callers holding
   * whoami's own answer - everything else must go through verifySession.
   */
  markSessionExpiredConfirmed: () => void
  /** Ask the server who we are; flips sessionExpired when auth has lapsed. */
  verifySession: () => Promise<boolean>
  /** Save unsaved work locally, then navigate so the proxy can sign us in. */
  reauthenticate: () => Promise<void>
  /** Let the user out of the dialog if we got it wrong. */
  dismiss: () => void
}

// A single in-flight whoami shared by every suspicious response, so a burst of
// failing requests produces one check rather than one per request.
let confirmInFlight: Promise<boolean> | null = null
// While the confirming whoami is running, its own failure must not re-enter
// this path - that would recurse.
let confirming = false
// Set when the user dismisses the dialog: stop nagging for the rest of the
// session rather than re-showing on the next request.
let suppressed = false

export const useAuthStore = create<AuthState>()((set, get) => ({
  sessionExpired: false,
  lastVerifiedAt: null,

  markSessionValid: () => {
    set({ sessionExpired: false, lastVerifiedAt: Date.now() })
  },

  markSessionExpiredConfirmed: () => {
    if (isDemoMode || suppressed) return
    set({ sessionExpired: true })
  },

  verifySession: async () => {
    // Demo mode has no backend and no auth - never block the UI there.
    if (isDemoMode) return true
    if (confirmInFlight) return confirmInFlight

    confirmInFlight = (async () => {
      confirming = true
      try {
        await identity.whoami()
        get().markSessionValid()
        return true
      } catch (e) {
        if (e instanceof AuthExpiredError) {
          // whoami is the authority: the session really is gone.
          if (!suppressed) set({ sessionExpired: true })
          return false
        }
        // Anything else (server down, offline, DNS, a 500) is not an auth
        // problem. Leave the session alone rather than blocking the app.
        return true
      } finally {
        confirming = false
        confirmInFlight = null
      }
    })()

    return confirmInFlight
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

  dismiss: () => {
    suppressed = true
    set({ sessionExpired: false })
  },
}))

// A response that looks like an expired session only *starts* a check. Acting
// on the response alone is how a routine 403/401 from an unrelated endpoint
// ends up blocking a perfectly good session.
onAuthExpired(() => {
  if (confirming || suppressed) return
  void useAuthStore.getState().verifySession()
})
