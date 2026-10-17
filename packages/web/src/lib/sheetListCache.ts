// SPDX-License-Identifier: MIT WITH Commons-Clause
// Cached "every sheet of every content type" listing for the wiki-link
// autocomplete.
//
// The popup is mounted only while a `[[` trigger is live, so its load-on-mount
// effect ran on *every* `[[` typed: one listing request per content type, each
// a whole-garden read and parse on the server. The listing changes rarely
// relative to how often it is asked for, so it is cached here, shared by every
// mount, with a short TTL as the backstop and explicit invalidation where the
// app knows the set of sheets changed (creation, garden switch).

import * as api from './api'
import type { ContentType } from '../stores/settingsStore'
import type { PageMeta } from '../types'

/** How long a listing is reused before the next request refetches it. */
const TTL_MS = 30_000

let cached: { sheets: PageMeta[]; at: number } | null = null
let inflight: Promise<PageMeta[]> | null = null

/** Drop the cache: the next caller refetches. */
export function invalidateSheetList(): void {
  cached = null
  inflight = null
}

/**
 * Every sheet of every content type, flattened. Concurrent callers share one
 * request; callers within the TTL share one result.
 */
export function listAllSheets(contentTypes: ContentType[]): Promise<PageMeta[]> {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return Promise.resolve(cached.sheets)
  }
  if (inflight) return inflight

  inflight = Promise.all(contentTypes.map((ct) => api.sheets.list(ct.id).catch(() => [])))
    .then((results) => {
      const flat = results.flat()
      cached = { sheets: flat, at: Date.now() }
      return flat
    })
    .finally(() => {
      inflight = null
    })

  return inflight
}
