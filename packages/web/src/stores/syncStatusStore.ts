// SPDX-License-Identifier: MIT WITH Commons-Clause
// Sync status tracking - tracks save/commit/push state for the current page
//
// Status progression (user-friendly terms):
// - unsaved: changes in browser, not yet sent to server
// - saved: written to disk on server
// - stored: in version history (git committed locally)
// - backed up: pushed to remote

import { create } from 'zustand'
import * as api from '../lib/api'

export type SyncStatus = 'unsaved' | 'saved' | 'stored' | 'backed up'

interface SyncStatusState {
  // Current status for the active page
  status: SyncStatus
  // Whether we're currently checking status
  isChecking: boolean
  // Last time we checked git status
  lastCheck: number | null

  // Actions
  setUnsaved: () => void
  setSaved: () => void
  checkGitStatus: (filePath: string) => Promise<void>
  recordCommit: () => void
  recordPush: () => void
}

export const useSyncStatusStore = create<SyncStatusState>()((set, get) => ({
  status: 'saved', // Default to saved (page loaded from server)
  isChecking: false,
  lastCheck: null,

  setUnsaved: () => {
    set({ status: 'unsaved' })
  },

  setSaved: () => {
    // Only update if currently unsaved (don't downgrade from stored/backed up)
    const current = get().status
    if (current === 'unsaved') {
      set({ status: 'saved' })
    }
  },

  // Check git status for a specific file to determine if it's stored/backed up
  checkGitStatus: async (filePath: string) => {
    set({ isChecking: true })
    try {
      const gitStatus = await api.git.status()

      // Check if this file has uncommitted changes
      const hasUncommitted = gitStatus.changedFiles?.some(
        (f) => f.path === filePath && (f.status === 'modified' || f.status === 'added')
      )

      if (hasUncommitted) {
        set({ status: 'saved', isChecking: false, lastCheck: Date.now() })
        return
      }

      // File is in version history. Check if we're ahead of remote (not yet backed up)
      if (gitStatus.ahead && gitStatus.ahead > 0) {
        set({ status: 'stored', isChecking: false, lastCheck: Date.now() })
      } else {
        set({ status: 'backed up', isChecking: false, lastCheck: Date.now() })
      }
    } catch (err) {
      console.error('[SyncStatus] Failed to check git status:', err)
      set({ isChecking: false })
    }
  },

  recordCommit: () => {
    set({ status: 'stored' })
  },

  recordPush: () => {
    set({ status: 'backed up' })
  },
}))
