// SPDX-License-Identifier: MIT WITH Commons-Clause
// Hook to get current garden information

import { useState, useEffect, useCallback } from 'react'
import { gardens, type Garden } from '../lib/api'

interface GardenInfo {
  garden: Garden | null
  isEncrypted: boolean
  loading: boolean
  error: string | null
  refresh: () => void
}

/**
 * Hook to get information about the current active garden.
 * Useful for checking encryption status to disable certain features.
 */
export function useGardenInfo(): GardenInfo {
  const [garden, setGarden] = useState<Garden | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchGarden = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await gardens.list()
      const active = response.gardens.find((g) => g.id === response.active)
      setGarden(active || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch garden info')
      setGarden(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchGarden()
  }, [fetchGarden])

  return {
    garden,
    isEncrypted: garden?.encrypted ?? false,
    loading,
    error,
    refresh: fetchGarden,
  }
}
