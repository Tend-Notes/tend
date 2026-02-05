// SPDX-License-Identifier: MIT WITH Commons-Clause
// Work timer banner - shows active task timer at top of app

import { useState, useEffect, useCallback } from 'react'
import { useWorkSessionStore, type WorkLogEntry } from '../../stores/workSessionStore'
import { usePageStore } from '../../stores/pageStore'
import { pages, journals, pageBlocksToApiFormat } from '../../lib/api'

// Format milliseconds as HH:MM:SS
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

// Save work log entry to block properties
async function saveWorkLogToBlock(
  pageName: string,
  blockUuid: string,
  entry: WorkLogEntry
): Promise<void> {
  // Determine if this is a journal or a page
  const isJournal = pageName.startsWith('journals/')
  const dateOrName = isJournal ? pageName.replace('journals/', '') : pageName

  // Fetch the current page/journal
  const page = isJournal ? await journals.get(dateOrName) : await pages.get(dateOrName)

  // Find the block
  const block = page.blocks[blockUuid]
  if (!block) {
    console.error('Block not found for work log:', blockUuid)
    return
  }

  // Parse existing work log or create new array
  let workLog: WorkLogEntry[] = []
  if (block.properties.work_log) {
    try {
      workLog = JSON.parse(block.properties.work_log)
    } catch {
      // Invalid JSON, start fresh
    }
  }

  // Add new entry
  workLog.push(entry)

  // Update block properties
  block.properties.work_log = JSON.stringify(workLog)

  // Save the page
  const blockData = pageBlocksToApiFormat(page)
  if (isJournal) {
    await journals.update(dateOrName, blockData, page.version)
  } else {
    await pages.update(dateOrName, blockData, page.version)
  }
}

export function WorkTimerBanner() {
  const { activeSession, showContinuePrompt, pauseSession, resumeSession, clearSession } = useWorkSessionStore()
  const { navigateToPage, navigateToJournal } = usePageStore()
  const [elapsed, setElapsed] = useState(0)
  const [showStopDialog, setShowStopDialog] = useState(false)
  const [stopNotes, setStopNotes] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // Update elapsed time every second
  useEffect(() => {
    if (!activeSession) {
      setElapsed(0)
      return
    }

    const updateElapsed = () => {
      if (activeSession.pausedAt) {
        setElapsed(activeSession.accumulatedMs)
      } else {
        const now = Date.now()
        const start = new Date(activeSession.startedAt).getTime()
        setElapsed(now - start + activeSession.accumulatedMs)
      }
    }

    updateElapsed()
    const interval = setInterval(updateElapsed, 1000)
    return () => clearInterval(interval)
  }, [activeSession])

  const handleNavigateToTask = useCallback(() => {
    if (!activeSession) return

    if (activeSession.pageName.startsWith('journals/')) {
      navigateToJournal(activeSession.pageName.replace('journals/', ''))
    } else {
      navigateToPage(activeSession.pageName)
    }
    // TODO: scroll to block
  }, [activeSession, navigateToPage, navigateToJournal])

  const handleStop = useCallback(() => {
    setShowStopDialog(true)
  }, [])

  const handleConfirmStop = useCallback(async () => {
    if (!activeSession) return

    setIsSaving(true)
    try {
      // Capture session info before stopping
      const { pageName, blockUuid } = activeSession
      const entry = useWorkSessionStore.getState().stopSession(stopNotes)

      if (entry) {
        // Save work log entry to block properties
        await saveWorkLogToBlock(pageName, blockUuid, entry)

        // Refresh the current page if it's the one we updated
        const currentPage = usePageStore.getState().currentPage
        if (currentPage?.name === pageName || `journals/${currentPage?.name}` === pageName) {
          // Re-fetch the page to get the updated work log
          if (pageName.startsWith('journals/')) {
            usePageStore.getState().navigateToJournal(pageName.replace('journals/', ''), false)
          } else {
            usePageStore.getState().navigateToPage(pageName, false)
          }
        }
      }
    } catch (error) {
      console.error('Failed to save work log:', error)
    } finally {
      setIsSaving(false)
      setShowStopDialog(false)
      setStopNotes('')
    }
  }, [stopNotes, activeSession])

  const handleCancelStop = useCallback(() => {
    setShowStopDialog(false)
    setStopNotes('')
  }, [])

  const handleContinueWorking = useCallback(() => {
    useWorkSessionStore.getState().setShowContinuePrompt(false)
  }, [])

  const handleDiscardSession = useCallback(() => {
    clearSession()
  }, [clearSession])

  if (!activeSession) return null

  const isPaused = !!activeSession.pausedAt
  const truncatedContent = activeSession.taskContent.length > 60
    ? activeSession.taskContent.slice(0, 60) + '...'
    : activeSession.taskContent

  // Continue prompt for cross-device detection
  if (showContinuePrompt) {
    return (
      <div className="bg-base-0A text-base-00 px-4 py-3 flex items-center justify-between gap-4 shadow-md">
        <div className="flex-1 min-w-0">
          <span className="font-medium">Task already active on another device:</span>{' '}
          <button
            onClick={handleNavigateToTask}
            className="hover:underline truncate"
          >
            {truncatedContent}
          </button>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleContinueWorking}
            className="px-3 py-1 bg-base-00 text-base-07 rounded text-sm font-medium hover:bg-base-01"
          >
            Continue Here
          </button>
          <button
            onClick={handleDiscardSession}
            className="px-3 py-1 bg-base-08 text-base-07 rounded text-sm font-medium hover:bg-base-08/80"
          >
            Discard
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="bg-base-07 text-base-00 px-4 py-2 flex items-center justify-between gap-4 shadow-md">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isPaused ? 'bg-base-0A' : 'bg-base-0B animate-pulse'}`} />
          <button
            onClick={handleNavigateToTask}
            className="hover:underline truncate text-left"
            title={activeSession.taskContent}
          >
            {truncatedContent}
          </button>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="font-mono text-lg tabular-nums">
            {formatDuration(elapsed)}
          </span>
          {isPaused ? (
            <button
              onClick={resumeSession}
              className="px-3 py-1 bg-base-0B text-base-00 rounded text-sm font-medium hover:bg-base-0B/80"
              title="Resume"
            >
              Resume
            </button>
          ) : (
            <button
              onClick={pauseSession}
              className="px-3 py-1 bg-base-0A text-base-00 rounded text-sm font-medium hover:bg-base-0A/80"
              title="Pause"
            >
              Pause
            </button>
          )}
          <button
            onClick={handleStop}
            className="px-3 py-1 bg-base-08 text-base-07 rounded text-sm font-medium hover:bg-base-08/80"
            title="Stop and log time"
          >
            Stop
          </button>
        </div>
      </div>

      {/* Stop dialog */}
      {showStopDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-base-00 rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-semibold text-base-07 mb-2">Stop Timer</h2>
            <p className="text-base-04 text-sm mb-4">
              Time worked: <span className="font-mono">{formatDuration(elapsed)}</span>
            </p>
            <textarea
              value={stopNotes}
              onChange={(e) => setStopNotes(e.target.value)}
              placeholder="Notes about this work session (optional)"
              className="w-full px-3 py-2 bg-base-01 border border-base-02 rounded text-base-07 placeholder-base-04 focus:outline-none focus:ring-2 focus:ring-base-0D resize-none"
              rows={3}
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={handleCancelStop}
                className="px-4 py-2 text-base-04 hover:text-base-07"
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmStop}
                disabled={isSaving}
                className="px-4 py-2 bg-base-0D text-base-00 rounded font-medium hover:bg-base-0D/80 disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : 'Save & Stop'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
