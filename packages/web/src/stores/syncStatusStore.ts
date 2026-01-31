// SPDX-License-Identifier: MIT WITH Commons-Clause
// Sync status tracking - tracks save/commit/push state for the current page
//
// Status progression (user-friendly terms):
// - unsaved: changes in browser, not yet sent to server
// - saved: written to disk on server
// - stored: in version history (git committed locally)
// - backed up: pushed to remote (only when remote backup is enabled)

import { create } from 'zustand'
import * as api from '../lib/api'
import { useSettingsStore } from './settingsStore'

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
  reset: () => void
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
      const backupEnabled = useSettingsStore.getState().backupEnabled

      // Check if this file has uncommitted changes (modified, added, or untracked)
      const fileInfo = gitStatus.changedFiles?.find((f) => f.path === filePath)
      const hasUncommitted = fileInfo && ['modified', 'added', 'untracked'].includes(fileInfo.status)

      if (hasUncommitted) {
        // File exists but isn't committed yet - it's just "saved"
        set({ status: 'saved', isChecking: false, lastCheck: Date.now() })
        return
      }

      // If the file isn't in changedFiles, it could be:
      // 1. Already committed and unchanged (in version history)
      // 2. A new file that git doesn't know about yet (untracked but not listed)
      //
      // Git status only shows untracked files if they exist on disk.
      // Since we're checking a page that should exist, if it's not in changedFiles
      // and there are no changes, it must be committed.

      // However, if the repo has no commits at all, nothing is "stored" yet
      if (!gitStatus.isRepo) {
        set({ status: 'saved', isChecking: false, lastCheck: Date.now() })
        return
      }

      // File is in version history. Check if we're synced with remote.
      // "backed up" requires: remote backup enabled AND remote exists AND not ahead
      if (!backupEnabled || !gitStatus.remote) {
        // Remote backup disabled or no remote - best we can say is "stored"
        set({ status: 'stored', isChecking: false, lastCheck: Date.now() })
      } else if (gitStatus.ahead && gitStatus.ahead > 0) {
        // Have remote but ahead of it - stored but not yet backed up
        set({ status: 'stored', isChecking: false, lastCheck: Date.now() })
      } else {
        // Remote backup enabled, have remote, and not ahead - fully backed up
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
    // Only show "backed up" if remote backup is enabled
    const backupEnabled = useSettingsStore.getState().backupEnabled
    if (backupEnabled) {
      set({ status: 'backed up' })
    }
  },

  reset: () => {
    set({ status: 'saved', isChecking: false, lastCheck: null })
  },
}))
