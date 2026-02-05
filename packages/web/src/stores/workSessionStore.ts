// SPDX-License-Identifier: MIT WITH Commons-Clause
// Work session state management

import { create } from 'zustand'

export interface WorkSession {
  blockUuid: string
  pageName: string
  contentType: string // "page", "journal", or custom content type ID
  sheetDate?: string // For date-organized content types (journals, etc.)
  taskContent: string
  startedAt: string // ISO 8601
  pausedAt?: string // ISO 8601, set when paused
  accumulatedMs: number // Time accumulated before current pause/resume cycle
}

export interface WorkLogEntry {
  startedAt: string
  endedAt: string
  durationMs: number
  notes: string
}

interface WorkSessionState {
  // Currently active session (null if no task is being worked on)
  activeSession: WorkSession | null

  // Whether we're showing the "continue from another device" prompt
  showContinuePrompt: boolean

  // Actions
  startSession: (blockUuid: string, pageName: string, contentType: string, sheetDate: string | undefined, taskContent: string) => void
  pauseSession: () => void
  resumeSession: () => void
  stopSession: (notes: string) => WorkLogEntry | null
  clearSession: () => void

  // For syncing from server
  setActiveSession: (session: WorkSession | null) => void
  setShowContinuePrompt: (show: boolean) => void
}

export const useWorkSessionStore = create<WorkSessionState>()((set, get) => ({
  activeSession: null,
  showContinuePrompt: false,

  startSession: (blockUuid, pageName, contentType, sheetDate, taskContent) => {
    set({
      activeSession: {
        blockUuid,
        pageName,
        contentType,
        sheetDate,
        taskContent,
        startedAt: new Date().toISOString(),
        accumulatedMs: 0,
      },
      showContinuePrompt: false,
    })
  },

  pauseSession: () => {
    const session = get().activeSession
    if (!session || session.pausedAt) return

    // Calculate time since last resume/start and add to accumulated
    const now = new Date()
    const lastStart = new Date(session.startedAt)
    const elapsed = now.getTime() - lastStart.getTime() + session.accumulatedMs

    set({
      activeSession: {
        ...session,
        pausedAt: now.toISOString(),
        accumulatedMs: elapsed,
      },
    })
  },

  resumeSession: () => {
    const session = get().activeSession
    if (!session || !session.pausedAt) return

    set({
      activeSession: {
        ...session,
        startedAt: new Date().toISOString(), // Reset start time to now
        pausedAt: undefined,
      },
    })
  },

  stopSession: (notes) => {
    const session = get().activeSession
    if (!session) return null

    const now = new Date()
    let totalMs: number

    if (session.pausedAt) {
      // Session is paused, use accumulated time
      totalMs = session.accumulatedMs
    } else {
      // Session is running, calculate current elapsed + accumulated
      const lastStart = new Date(session.startedAt)
      totalMs = now.getTime() - lastStart.getTime() + session.accumulatedMs
    }

    const entry: WorkLogEntry = {
      startedAt: session.startedAt,
      endedAt: now.toISOString(),
      durationMs: totalMs,
      notes,
    }

    set({ activeSession: null, showContinuePrompt: false })

    return entry
  },

  clearSession: () => {
    set({ activeSession: null, showContinuePrompt: false })
  },

  setActiveSession: (session) => {
    set({ activeSession: session })
  },

  setShowContinuePrompt: (show) => {
    set({ showContinuePrompt: show })
  },
}))
