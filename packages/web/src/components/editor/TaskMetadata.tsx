// SPDX-License-Identifier: MIT WITH Commons-Clause
// Inline task metadata component for displaying and editing due date, start date, and priority

import { useState } from 'react'
import { DatePickerPopover } from '../ui/DatePickerPopover'
import { PriorityPickerPopover, getPriorityDisplay } from '../ui/PriorityPickerPopover'
import { formatShortDate, getUrgencyStyle } from '../../lib/dateUtils'

interface TaskMetadataProps {
  blockUuid: string
  properties: Record<string, string>
  onPropertyChange: (key: string, value: string | null) => void
  isCompleted?: boolean
}

export function TaskMetadata({ blockUuid: _, properties, onPropertyChange, isCompleted }: TaskMetadataProps) {
  void _ // blockUuid available for future use
  const [showDueDatePicker, setShowDueDatePicker] = useState(false)
  const [showStartDatePicker, setShowStartDatePicker] = useState(false)
  const [showPriorityPicker, setShowPriorityPicker] = useState(false)

  const dueDate = properties.due_date || null
  const startDate = properties.start_date || null
  const priority = properties.priority || null

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
    </div>
  )
}
