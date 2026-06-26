// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Canonical sheet-name handling — the single frontend authority for turning a
// sheet's parts (content type + bare name + optional date) into its canonical
// name string, and back. Mirrors crates/tend-core/src/name.rs exactly (kept in
// sync via the shared cases in name.test-vector).
//
// The canonical name is what the backend stores as Page.name, what the link
// index is keyed by, and what goes inside [[wikilinks]]. It is NOT the on-disk
// path and NOT the display name (which may be truncated for cleanliness).
//
// Canonical forms by organization:
//   page (flat default):      "My Page"                    (bare)
//   journal (date-named):     "2026-01-21"                 (bare date)
//   custom flat:              "person/John"                (dir-prefixed)
//   custom date-foldered:     "meeting/2026-01-30/Standup" (dir + date + name)

import type { ContentType } from '../stores/settingsStore'

export interface ParsedName {
  contentTypeId: string
  bareName: string
  date?: string
}

// Whether Page.name embeds the directory. Page and date-named types (journals)
// use bare names; every other type is directory-prefixed. Mirrors
// ContentType::name_includes_directory() on the backend.
function nameIncludesDirectory(ct: ContentType): boolean {
  return !(ct.id === 'page' || ct.organization === 'dateNamed')
}

// Build the canonical name for a content type + bare name (+ date).
export function qualifyName(ct: ContentType, bareName: string, date?: string): string {
  if (!nameIncludesDirectory(ct)) return bareName
  if (ct.organization === 'dateFoldered') {
    return date ? `${ct.directory}/${date}/${bareName}` : `${ct.directory}/${bareName}`
  }
  return `${ct.directory}/${bareName}`
}

// Split a canonical name back into its bare name and date, given a KNOWN type.
// Inverse of qualifyName.
export function splitName(ct: ContentType, canonical: string): { bareName: string; date?: string } {
  if (!nameIncludesDirectory(ct)) {
    // page (no date) or journal (the bare name is the date).
    return ct.organization === 'dateNamed'
      ? { bareName: canonical, date: canonical }
      : { bareName: canonical }
  }
  const prefix = `${ct.directory}/`
  const rest = canonical.startsWith(prefix) ? canonical.slice(prefix.length) : canonical
  if (ct.organization === 'dateFoldered') {
    const slash = rest.indexOf('/')
    if (slash > 0) {
      return { bareName: rest.slice(slash + 1), date: rest.slice(0, slash) }
    }
    return { bareName: rest }
  }
  return { bareName: rest }
}

// Parse a canonical name, inferring the content type from a known directory
// prefix. A name with no matching prefix is a page (the bare fallback).
export function parseName(raw: string, contentTypes: ContentType[]): ParsedName {
  for (const ct of contentTypes) {
    if (!nameIncludesDirectory(ct)) continue
    const prefix = `${ct.directory}/`
    if (raw.startsWith(prefix)) {
      const { bareName, date } = splitName(ct, raw)
      return { contentTypeId: ct.id, bareName, date }
    }
  }
  return { contentTypeId: 'page', bareName: raw }
}
