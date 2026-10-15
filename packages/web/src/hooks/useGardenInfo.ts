// SPDX-License-Identifier: MIT WITH Commons-Clause
// Encryption and search-index state for the active garden.

import { useState, useEffect, useCallback } from 'react'
import { search, type SearchStatus, type IndexStatus } from '../lib/api'
import { useSettingsStore } from '../stores/settingsStore'

interface GardenInfo {
  /** Whether the active garden is encrypted */
  isEncrypted: boolean
  /** Lifecycle of the full-text index, or null before the first fetch lands */
  indexStatus: IndexStatus | null
  /** A plaintext index directory is sitting on disk (see SearchStatus) */
  indexOnDisk: boolean
  numDocs: number | null
  loading: boolean
  error: string | null
  refresh: () => void
}

/**
 * State of the active garden's encryption and full-text index.
 *
 * Reads `GET /search/status`, which carries the garden's `encrypted` flag
 * alongside the index lifecycle, so one request answers both "is this garden
 * encrypted" and "does a plaintext index of it exist right now".
 */
export function useGardenInfo(): GardenInfo {
  const [status, setStatus] = useState<SearchStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Garden switches and unlocks both land here (the garden_switched WebSocket
  // handler sets it), so this doubles as the refetch trigger.
  const currentGraphId = useSettingsStore((s) => s.currentGraphId)

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setStatus(await search.status())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch search status')
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus, currentGraphId])

  return {
    isEncrypted: status?.encrypted ?? false,
    indexStatus: status?.indexStatus ?? null,
    indexOnDisk: status?.indexOnDisk ?? false,
    numDocs: status?.numDocs ?? null,
    loading,
    error,
    refresh: fetchStatus,
  }
}
