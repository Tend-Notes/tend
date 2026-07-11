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
 * Delete the API content caches and clear all unsaved drafts. Best-effort: a
 * failure to clear one store must not block the switch, so errors are logged
 * and swallowed.
 */
export async function clearUserScopedContent(): Promise<void> {
  const tasks: Promise<unknown>[] = []

  if (typeof caches !== 'undefined') {
    for (const name of CONTENT_CACHE_NAMES) {
      tasks.push(caches.delete(name))
    }
  }

  tasks.push(clearAllDrafts())

  const results = await Promise.allSettled(tasks)
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('Failed to clear cached content on identity change:', result.reason)
    }
  }
}
