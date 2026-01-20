// SPDX-License-Identifier: MIT WITH Commons-Clause
// Auto-commit hook - manages periodic and smart commit triggers

import { useEffect, useRef, useCallback } from 'react'
import { useGitStore, SMART_THRESHOLDS } from '../stores/gitStore'
import { usePageStore } from '../stores/pageStore'
import { useActivityLogStore } from '../stores/activityLogStore'
import { useSyncStatusStore } from '../stores/syncStatusStore'
import * as api from '../lib/api'

// Calculate total character count from blocks
function calculateTotalChars(blocks: Record<string, { content: string }>): number {
  return Object.values(blocks).reduce((sum, block) => sum + (block.content?.length || 0), 0)
}

export function useAutoCommit() {
  const {
    autoCommitIntervalMinutes,
    smartCommitThreshold,
    autoCommitEnabled,
    lastCommitTime,
    smartCommitWindowChars,
    recordCharacterChange,
    recordCommit,
  } = useGitStore()

  const { currentPage } = usePageStore()
  const addLogEntry = useActivityLogStore((state) => state.addEntry)

  // Track previous character count to detect changes
  const prevCharCountRef = useRef<number>(0)
  const autoCommitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Trigger auto-commit
  const triggerAutoCommit = useCallback(async () => {
    if (!autoCommitEnabled) return

    try {
      // Check if there are actual changes first
      const status = await api.git.status()
      if (!status.hasChanges) {
        console.log('[AutoCommit] No changes to commit')
        // Don't log "no changes" - it would be noisy
        return
      }

      const result = await api.git.commit()
      if (result.commitSha) {
        console.log('[AutoCommit] Success:', result.message)
        const totalChars = currentPage ? calculateTotalChars(currentPage.blocks) : 0
        recordCommit(totalChars)
        addLogEntry('git_auto_commit', result.message || 'Auto-commit', result.commitSha?.slice(0, 7))
        // Update sync status to "stored" (in version history)
        useSyncStatusStore.getState().recordCommit()
      }
    } catch (err) {
      console.error('[AutoCommit] Failed:', err)
      addLogEntry('git_error', 'Auto-commit failed', err instanceof Error ? err.message : 'Unknown error')
    }
  }, [autoCommitEnabled, currentPage, recordCommit, addLogEntry])

  // Track character changes when blocks update
  useEffect(() => {
    if (!currentPage) return

    const currentCharCount = calculateTotalChars(currentPage.blocks)
    const delta = currentCharCount - prevCharCountRef.current

    // Only track if there's a meaningful change (not initial load)
    if (prevCharCountRef.current > 0 && delta !== 0) {
      recordCharacterChange(delta)
    }

    prevCharCountRef.current = currentCharCount
  }, [currentPage, recordCharacterChange])

  // Check for smart commit trigger
  useEffect(() => {
    if (!autoCommitEnabled) return

    const threshold = SMART_THRESHOLDS[smartCommitThreshold]
    if (smartCommitWindowChars >= threshold) {
      console.log(
        `[AutoCommit] Smart commit triggered: ${smartCommitWindowChars} chars >= ${threshold} threshold`
      )
      triggerAutoCommit()
    }
  }, [autoCommitEnabled, smartCommitThreshold, smartCommitWindowChars, triggerAutoCommit])

  // Set up periodic auto-commit timer
  useEffect(() => {
    // Clear existing timer
    if (autoCommitTimerRef.current) {
      clearInterval(autoCommitTimerRef.current)
      autoCommitTimerRef.current = null
    }

    if (!autoCommitEnabled || autoCommitIntervalMinutes <= 0) return

    const intervalMs = autoCommitIntervalMinutes * 60 * 1000

    // Calculate time until next commit
    const timeSinceLastCommit = lastCommitTime ? Date.now() - lastCommitTime : intervalMs
    const timeUntilNextCommit = Math.max(0, intervalMs - timeSinceLastCommit)

    // Set up initial delayed commit, then regular interval
    const initialTimeout = setTimeout(() => {
      triggerAutoCommit()

      // Set up regular interval after initial commit
      autoCommitTimerRef.current = setInterval(() => {
        triggerAutoCommit()
      }, intervalMs)
    }, timeUntilNextCommit)

    return () => {
      clearTimeout(initialTimeout)
      if (autoCommitTimerRef.current) {
        clearInterval(autoCommitTimerRef.current)
      }
    }
  }, [autoCommitEnabled, autoCommitIntervalMinutes, lastCommitTime, triggerAutoCommit])

  // Initialize commit time on first load
  useEffect(() => {
    if (!lastCommitTime && autoCommitEnabled) {
      // Set initial commit time to now to avoid immediate commit on load
      recordCommit(0)
    }
  }, [lastCommitTime, autoCommitEnabled, recordCommit])

  return { triggerAutoCommit }
}
