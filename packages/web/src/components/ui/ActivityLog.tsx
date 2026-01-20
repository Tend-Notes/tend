// SPDX-License-Identifier: MIT WITH Commons-Clause
// Activity log component - shows file saves, git commits, etc.

import { useState } from 'react'
import { useActivityLogStore, formatActivityTime, type ActivityType } from '../../stores/activityLogStore'

const typeIcons: Record<ActivityType, string> = {
  file_save: 'text-base-0B', // green - success
  git_commit: 'text-base-0D', // purple - git
  git_auto_commit: 'text-base-0D', // purple - git
  git_error: 'text-base-08', // red - error
  file_change: 'text-base-0A', // yellow - change
}

const typeLabels: Record<ActivityType, string> = {
  file_save: 'Saved',
  git_commit: 'Committed',
  git_auto_commit: 'Auto-committed',
  git_error: 'Git error',
  file_change: 'Changed',
}

export function ActivityLog() {
  const { entries } = useActivityLogStore()
  const [isExpanded, setIsExpanded] = useState(false)

  // Get the most recent entry for collapsed view
  const latestEntry = entries[0]

  if (entries.length === 0) {
    return (
      <div className="border-t border-base-02 px-4 py-2">
        <div className="text-[10px] text-base-03 italic">No activity yet</div>
      </div>
    )
  }

  return (
    <div className="border-t border-base-02">
      {/* Header / collapsed view */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-2 flex items-center gap-2 text-left hover:bg-base-01 transition-colors"
      >
        {/* Expand/collapse indicator */}
        <svg
          className={`w-2.5 h-2.5 text-base-03 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>

        {/* Latest activity */}
        {latestEntry && (
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <span className={`text-[10px] font-medium ${typeIcons[latestEntry.type]}`}>
              {typeLabels[latestEntry.type]}
            </span>
            <span className="text-[10px] text-base-04 truncate flex-1">
              {latestEntry.message}
            </span>
            <span className="text-[10px] text-base-03 flex-shrink-0">
              {formatActivityTime(latestEntry.timestamp)}
            </span>
          </div>
        )}

        {/* Entry count badge */}
        {entries.length > 1 && (
          <span className="text-[9px] text-base-03 bg-base-02 px-1.5 py-0.5 rounded">
            {entries.length}
          </span>
        )}
      </button>

      {/* Expanded log */}
      {isExpanded && (
        <div className="max-h-40 overflow-y-auto border-t border-base-02 bg-base-00">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="px-4 py-1.5 flex items-start gap-2 hover:bg-base-01 transition-colors"
            >
              <span className={`text-[10px] font-medium w-20 flex-shrink-0 ${typeIcons[entry.type]}`}>
                {typeLabels[entry.type]}
              </span>
              <span className="text-[10px] text-base-04 flex-1 min-w-0 truncate">
                {entry.message}
                {entry.details && (
                  <span className="text-base-03 ml-1">({entry.details})</span>
                )}
              </span>
              <span className="text-[10px] text-base-03 flex-shrink-0">
                {formatActivityTime(entry.timestamp)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
