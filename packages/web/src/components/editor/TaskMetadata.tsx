// SPDX-License-Identifier: MIT WITH Commons-Clause
// Inline task metadata component for displaying and editing due date, start date, and priority

import { useShallow } from 'zustand/react/shallow'
import { useState, useMemo } from 'react'
import { DatePickerPopover } from '../ui/DatePickerPopover'
import { PriorityPickerPopover, getPriorityDisplay } from '../ui/PriorityPickerPopover'
import { formatShortDate, getUrgencyStyle } from '../../lib/dateUtils'
import { useWorkSessionStore, type WorkLogEntry } from '../../stores/workSessionStore'
import { usePageStore } from '../../stores/pageStore'

// Format milliseconds as human-readable duration
function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

// Format ISO date as short date string
function formatLogDate(isoDate: string): string {
  const date = new Date(isoDate)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

interface TaskMetadataProps {
  blockUuid: string
  properties: Record<string, string>
  onPropertyChange: (key: string, value: string | null) => void
  isCompleted?: boolean
  taskContent?: string
  // The page this task lives on, for the work timer. Defaults to the currently
  // open page (editor); the task manager passes the task's own page so the timer
  // works there too.
  taskPage?: { name: string; contentType: string; sheetDate?: string | null }
}

export function TaskMetadata({ blockUuid, properties, onPropertyChange, isCompleted, taskContent, taskPage }: TaskMetadataProps) {
  const [showDueDatePicker, setShowDueDatePicker] = useState(false)
  const [showStartDatePicker, setShowStartDatePicker] = useState(false)
  const [showPriorityPicker, setShowPriorityPicker] = useState(false)
  const [showWorkLog, setShowWorkLog] = useState(false)

  const { activeSession, startSession } = useWorkSessionStore(useShallow((s) => ({ activeSession: s.activeSession, startSession: s.startSession })))
  const currentPage = usePageStore((state) => state.currentPage)

  // Check if this task is the currently active work session
  const isActiveTask = activeSession?.blockUuid === blockUuid
  const hasActiveSession = activeSession !== null

  const handleStartTimer = () => {
    // Prefer an explicitly-provided page (task manager); fall back to the open page.
    const page = taskPage ?? (currentPage
      ? { name: currentPage.name, contentType: currentPage.contentType, sheetDate: currentPage.journalDate }
      : null)
    if (!page || !taskContent) return
    startSession(blockUuid, page.name, page.contentType, page.sheetDate ?? undefined, taskContent)
  }

  const dueDate = properties.due_date || null
  const startDate = properties.start_date || null
  const priority = properties.priority || null

  // Parse work log from properties
  const workLog = useMemo((): WorkLogEntry[] => {
    if (!properties.work_log) return []
    try {
      return JSON.parse(properties.work_log)
    } catch {
      return []
    }
  }, [properties.work_log])

  // Calculate total time worked
  const totalTimeWorked = useMemo(() => {
    return workLog.reduce((sum, entry) => sum + entry.durationMs, 0)
  }, [workLog])

  const priorityInfo = getPriorityDisplay(priority)
  // Urgency based on start date if set, otherwise due date
  // Completed tasks don't show urgency styling
  const urgencyDate = startDate || dueDate
  const urgencyStyle = urgencyDate && !isCompleted ? getUrgencyStyle(urgencyDate) : null

  // Prevent click events from propagating to the block container
  const stopPropagation = (e: React.MouseEvent) => {
    e.stopPropagation()
  }

  return (
    <>
    <div
      className="flex items-center gap-2 mt-1 ml-0.5 text-xs"
      onClick={stopPropagation}
    >
      {/* Due Date */}
      <div className="relative">
        <button
          onClick={() => setShowDueDatePicker(!showDueDatePicker)}
          className={`
            inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors
            ${dueDate
              ? 'bg-base-01 hover:bg-base-02'
              : 'text-base-03 hover:text-base-04 hover:bg-base-01'
            }
          `}
          title={dueDate ? `Due: ${dueDate}` : 'Set due date'}
          style={urgencyStyle?.style}
        >
          {/* Calendar icon */}
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {dueDate && (
            <span>{formatShortDate(dueDate)}</span>
          )}
        </button>
        {showDueDatePicker && (
          <DatePickerPopover
            value={dueDate}
            onChange={(date) => onPropertyChange('due_date', date)}
            onClose={() => setShowDueDatePicker(false)}
            label="Due Date"
          />
        )}
      </div>

      {/* Start Date */}
      <div className="relative">
          <button
            onClick={() => setShowStartDatePicker(!showStartDatePicker)}
            className={`
              inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors
              ${startDate
                ? 'bg-base-01 hover:bg-base-02 text-base-05'
                : 'text-base-03 hover:text-base-04 hover:bg-base-01'
              }
            `}
            title={startDate ? `Start: ${startDate}` : 'Set start date'}
          >
            {/* Play/start icon */}
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {startDate && (
              <span>{formatShortDate(startDate)}</span>
            )}
          </button>
          {showStartDatePicker && (
            <DatePickerPopover
              value={startDate}
              onChange={(date) => onPropertyChange('start_date', date)}
              onClose={() => setShowStartDatePicker(false)}
              label="Start Date"
            />
          )}
      </div>

      {/* Priority */}
      <div className="relative">
        <button
          onClick={() => setShowPriorityPicker(!showPriorityPicker)}
          className={`
            inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded transition-colors
            ${priority
              ? 'bg-base-01 hover:bg-base-02'
              : 'text-base-03 hover:text-base-04 hover:bg-base-01'
            }
          `}
          title={priority ? `Priority: ${priorityInfo.label}` : 'Set priority'}
        >
          {priority ? (
            <span
              className="font-bold"
              style={{ color: priorityInfo.color }}
            >
              {priorityInfo.indicator}
            </span>
          ) : (
            /* Flag icon for no priority */
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
            </svg>
          )}
        </button>
        {showPriorityPicker && (
          <PriorityPickerPopover
            value={priority}
            onChange={(p) => onPropertyChange('priority', p)}
            onClose={() => setShowPriorityPicker(false)}
          />
        )}
      </div>

      {/* Work Timer - only show for incomplete tasks */}
      {!isCompleted && (
        <div className="relative">
          {isActiveTask ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-base-0B">
              <span className="w-2 h-2 rounded-full bg-base-0B animate-pulse" />
              Working
            </span>
          ) : (
            <button
              onClick={handleStartTimer}
              disabled={hasActiveSession}
              className={`
                inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors
                ${hasActiveSession
                  ? 'text-base-03 cursor-not-allowed'
                  : 'text-base-03 hover:text-base-0B hover:bg-base-01'
                }
              `}
              title={hasActiveSession ? 'Stop current task first' : 'Start work timer'}
            >
              {/* Timer/clock icon */}
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Start
            </button>
          )}
        </div>
      )}

      {/* Time worked - show total if there are entries */}
      {workLog.length > 0 && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-base-04">
          <span>Time worked:</span>
          <span className="font-mono">{formatDuration(totalTimeWorked)}</span>
        </span>
      )}
    </div>

    {/* View entries bar - full width, expands to show work log */}
    {workLog.length > 0 && (
      <div className="mt-1 w-full border border-base-02 rounded bg-base-02">
        <button
          onClick={() => setShowWorkLog(!showWorkLog)}
          className="w-full flex items-center justify-between px-2 py-1 text-xs transition-colors text-base-04 hover:text-base-05"
        >
          <span>View entries ({workLog.length})</span>
          {/* Chevron icon - points down when collapsed, up when expanded */}
          <svg
            className={`w-4 h-4 transition-transform ${showWorkLog ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Expanded Work Log Table */}
        {showWorkLog && (
          <div className="px-2 py-2 text-xs border-t border-base-03">
            <table className="w-full">
              <thead>
                <tr className="text-base-04 border-b border-base-03">
                  <th className="text-left py-1 pr-2 font-medium w-16">Date</th>
                  <th className="text-right py-1 pr-3 font-medium w-14">Time</th>
                  <th className="text-left py-1 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {workLog.map((entry, i) => (
                  <tr key={i} className="border-b border-base-03/50 last:border-0">
                    <td className="py-1 pr-2 text-base-04 whitespace-nowrap">{formatLogDate(entry.startedAt)}</td>
                    <td className="py-1 pr-3 text-right font-mono whitespace-nowrap">{formatDuration(entry.durationMs)}</td>
                    <td className="py-1 text-base-05">{entry.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-base-03 font-medium">
                  <td className="py-1 pr-2 text-base-05">Total</td>
                  <td className="py-1 pr-3 text-right font-mono text-base-05">{formatDuration(totalTimeWorked)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    )}
  </>
  )
}
