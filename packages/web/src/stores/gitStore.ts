// SPDX-License-Identifier: MIT WITH Commons-Clause
// Git auto-commit and smart commit state management

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import * as api from '../lib/api'

// Smart commit thresholds (characters)
export const SMART_THRESHOLDS = {
  paragraph: 500, // ~1 paragraph
  page: 2000, // ~1 page
  pages: 5000, // several pages
} as const

export type SmartThresholdLevel = keyof typeof SMART_THRESHOLDS

interface GitState {
  // Settings
  autoCommitIntervalMinutes: number
  smartCommitThreshold: SmartThresholdLevel
  autoCommitEnabled: boolean

  // Tracking state
  lastCommitTime: number | null
  characterCountAtLastCommit: number
  smartCommitWindowStart: number | null
  smartCommitWindowChars: number

  // Actions
  setAutoCommitInterval: (minutes: number) => void
  setSmartCommitThreshold: (level: SmartThresholdLevel) => void
  setAutoCommitEnabled: (enabled: boolean) => void
  recordCharacterChange: (delta: number) => void
  recordCommit: (totalChars: number) => void
  checkSmartCommit: () => boolean
  checkAutoCommit: () => boolean
  triggerAutoCommit: () => Promise<void>
  resetAll: () => void
}

export const useGitStore = create<GitState>()(
  persist(
    (set, get) => ({
      // Default settings
      autoCommitIntervalMinutes: 10,
      smartCommitThreshold: 'page',
      autoCommitEnabled: true,

      // Tracking state
      lastCommitTime: null,
      characterCountAtLastCommit: 0,
      smartCommitWindowStart: null,
      smartCommitWindowChars: 0,

      setAutoCommitInterval: (minutes) => {
        set({ autoCommitIntervalMinutes: minutes })
      },

      setSmartCommitThreshold: (level) => {
        set({ smartCommitThreshold: level })
      },

      setAutoCommitEnabled: (enabled) => {
        set({ autoCommitEnabled: enabled })
      },

      // Track character changes for smart commit detection
      recordCharacterChange: (delta) => {
        const now = Date.now()
        const state = get()
        const SMART_COMMIT_WINDOW_MS = 2 * 60 * 1000 // 2 minutes

        // If no window or window expired, start a new one
        if (
          !state.smartCommitWindowStart ||
          now - state.smartCommitWindowStart > SMART_COMMIT_WINDOW_MS
        ) {
          set({
            smartCommitWindowStart: now,
            smartCommitWindowChars: Math.max(0, delta),
          })
        } else {
          // Add to current window (only count positive deltas - new content)
          set({
            smartCommitWindowChars: state.smartCommitWindowChars + Math.max(0, delta),
          })
        }
      },

      // Record that a commit happened
      recordCommit: (totalChars) => {
        set({
          lastCommitTime: Date.now(),
          characterCountAtLastCommit: totalChars,
          smartCommitWindowStart: null,
          smartCommitWindowChars: 0,
        })
      },

      // Check if smart commit should trigger
      checkSmartCommit: () => {
        const state = get()
        if (!state.autoCommitEnabled) return false

        const threshold = SMART_THRESHOLDS[state.smartCommitThreshold]
        return state.smartCommitWindowChars >= threshold
      },

      // Check if auto commit should trigger (based on time)
      checkAutoCommit: () => {
        const state = get()
        if (!state.autoCommitEnabled) return false
        if (!state.lastCommitTime) return false // Don't auto-commit on first load

        const intervalMs = state.autoCommitIntervalMinutes * 60 * 1000
        return Date.now() - state.lastCommitTime >= intervalMs
      },

      // Trigger an auto-commit
      triggerAutoCommit: async () => {
        try {
          const result = await api.git.commit()
          if (result.commitSha) {
            console.log('[GitStore] Auto-commit successful:', result.message)
            // Don't need to call recordCommit here - the page save will handle it
          }
        } catch (err) {
          console.error('[GitStore] Auto-commit failed:', err)
        }
      },

      // Full reset for user switching
      resetAll: () => set({
        autoCommitIntervalMinutes: 10,
        smartCommitThreshold: 'page',
        autoCommitEnabled: true,
        lastCommitTime: null,
        characterCountAtLastCommit: 0,
        smartCommitWindowStart: null,
        smartCommitWindowChars: 0,
      }),
    }),
    {
      name: 'tend-git-settings',
      // Only persist settings, not tracking state
      partialize: (state) => ({
        autoCommitIntervalMinutes: state.autoCommitIntervalMinutes,
        smartCommitThreshold: state.smartCommitThreshold,
        autoCommitEnabled: state.autoCommitEnabled,
      }),
    }
  )
)
