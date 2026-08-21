// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Purge per-user/per-garden cached content when the active identity changes.
//!
//! On a shared browser, the service worker's runtime caches and the IndexedDB
//! draft store can otherwise serve one user's (or a now-locked encrypted
//! garden's) plaintext content to the next user. Call this on a whoami mismatch
//! and on garden switch/lock so no prior content survives the transition.

import { clearAllDrafts } from './draftStore'

/** Named runtime caches that hold API responses with note content. */
const CONTENT_CACHE_NAMES = ['api-pages', 'api-journals']

/**
 * Delete the service-worker runtime caches that hold note content, so a reload
 * on a shared machine cannot serve them. Does NOT touch unsaved drafts, which
 * the session-expiry flow keeps for recovery after re-login. Best-effort.
 */
export async function clearContentCaches(): Promise<void> {
  if (typeof caches === 'undefined') return

  const results = await Promise.allSettled(
    CONTENT_CACHE_NAMES.map((name) => caches.delete(name)),
  )
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('Failed to clear content cache:', result.reason)
    }
  }
}

/**
 * Delete the API content caches AND clear all unsaved drafts. Use when the
 * identity actually changes (whoami mismatch, garden switch/lock) so no prior
 * user's content — cached or draft — survives. Best-effort.
 */
export async function clearUserScopedContent(): Promise<void> {
  const results = await Promise.allSettled([clearContentCaches(), clearAllDrafts()])
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('Failed to clear cached content on identity change:', result.reason)
    }
  }
}
