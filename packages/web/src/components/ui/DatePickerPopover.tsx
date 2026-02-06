// SPDX-License-Identifier: MIT WITH Commons-Clause
// Date picker popover for task due dates and start dates

import { useState, useRef, useMemo, useLayoutEffect } from 'react'
import { formatDateYMD, getDateOffset, getNextMonday, getNextMonth } from '../../lib/dateUtils'
import {
  getDaysInMonth,
  getFirstDayOfMonth,
  formatCalendarDate,
  parseCalendarDate,
  MONTH_NAMES,
  DAY_NAMES,
} from '../../lib/calendarUtils'
import { useClickOutside } from '../../hooks/useClickOutside'
import { useEscapeKey } from '../../hooks/useEscapeKey'

interface DatePickerPopoverProps {
  value: string | null
  onChange: (date: string | null) => void
  onClose: () => void
  label?: string
}

export function DatePickerPopover({ value, onChange, onClose, label }: DatePickerPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)

  // Parse current value or use today
  const today = useMemo(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() }
  }, [])

  const todayStr = formatDateYMD(new Date())

  // Initialize view to the selected date or today
  const initialDate = useMemo(() => {
    if (value) {
      return parseCalendarDate(value)
    }
    return today
  }, [value, today])

  const [viewYear, setViewYear] = useState(initialDate.year)
  const [viewMonth, setViewMonth] = useState(initialDate.month)

  useClickOutside(popoverRef, onClose)
  useEscapeKey(onClose)

  // Navigate months
  const goToPrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11)
      setViewYear(viewYear - 1)
    } else {
      setViewMonth(viewMonth - 1)
    }
  }

  const goToNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0)
      setViewYear(viewYear + 1)
    } else {
      setViewMonth(viewMonth + 1)
    }
  }

  const goToToday = () => {
    setViewYear(today.year)
    setViewMonth(today.month)
  }

  // Handle day click
  const handleDayClick = (dateStr: string) => {
    onChange(dateStr)
    onClose()
  }

  // Quick actions
  const handleQuickAction = (dateStr: string | null) => {
    onChange(dateStr)
    onClose()
  }

  // Build calendar grid
  const daysInMonth = getDaysInMonth(viewYear, viewMonth)
  const firstDay = getFirstDayOfMonth(viewYear, viewMonth)

  // Create array of day cells (including empty ones for alignment)
  const dayCells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) {
    dayCells.push(null)
  }
  for (let day = 1; day <= daysInMonth; day++) {
    dayCells.push(day)
  }

  // Viewport-aware positioning
  const [position, setPosition] = useState<{
    top: string
    left: number | string
    right: string
    bottom?: string
  }>({ top: '100%', left: 0, right: 'auto' })
  useLayoutEffect(() => {
    if (popoverRef.current) {
      const rect = popoverRef.current.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      // Check if popover goes off right edge
      if (rect.right > viewportWidth - 16) {
        setPosition(pos => ({ ...pos, left: 'auto', right: '0' }))
      }

      // Check if popover goes off bottom edge
      if (rect.bottom > viewportHeight - 16) {
        setPosition(pos => ({ ...pos, top: 'auto', bottom: '100%' as string }))
      }
    }
  }, [])

  return (
    <div
      ref={popoverRef}
      className="absolute z-50 bg-base-00 border border-base-02 rounded-lg shadow-lg p-3 w-[280px]"
      style={{
        top: position.top === 'auto' ? undefined : position.top,
        bottom: position.bottom,
        left: position.left === 'auto' ? undefined : position.left,
        right: position.right === 'auto' ? undefined : position.right,
        marginTop: position.top === '100%' ? '4px' : undefined,
        marginBottom: position.bottom === '100%' ? '4px' : undefined,
      }}
    >
      {/* Label */}
      {label && (
        <div className="text-xs text-base-04 mb-2">{label}</div>
      )}

      {/* Quick actions */}
      <div className="flex flex-wrap gap-1 mb-3">
        <button
          onClick={() => handleQuickAction(todayStr)}
          className="px-2 py-1 text-xs rounded bg-base-01 text-base-05 hover:bg-base-02 transition-colors"
        >
          Today
        </button>
        <button
          onClick={() => handleQuickAction(getDateOffset(1))}
          className="px-2 py-1 text-xs rounded bg-base-01 text-base-05 hover:bg-base-02 transition-colors"
        >
          Tomorrow
        </button>
        <button
          onClick={() => handleQuickAction(getNextMonday())}
          className="px-2 py-1 text-xs rounded bg-base-01 text-base-05 hover:bg-base-02 transition-colors"
        >
          Next Week
        </button>
        <button
          onClick={() => handleQuickAction(getNextMonth())}
          className="px-2 py-1 text-xs rounded bg-base-01 text-base-05 hover:bg-base-02 transition-colors"
        >
          Next Month
        </button>
        {value && (
          <button
            onClick={() => handleQuickAction(null)}
            className="px-2 py-1 text-xs rounded bg-base-08/20 text-base-08 hover:bg-base-08/30 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Header with month navigation */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={goToPrevMonth}
          className="p-1 text-base-04 hover:text-base-05 transition-colors"
          title="Previous month"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <button
          onClick={goToToday}
          className="text-sm font-medium text-base-05 hover:text-base-06 transition-colors"
          title="Go to today"
        >
          {MONTH_NAMES[viewMonth]} {viewYear}
        </button>

        <button
          onClick={goToNextMonth}
          className="p-1 text-base-04 hover:text-base-05 transition-colors"
          title="Next month"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Day names header */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {DAY_NAMES.map((day) => (
          <div key={day} className="text-center text-xs text-base-04 font-medium py-1">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {dayCells.map((day, index) => {
          if (day === null) {
            return <div key={`empty-${index}`} className="w-8 h-8" />
          }

          const dateStr = formatCalendarDate(viewYear, viewMonth, day)
          const isToday = viewYear === today.year && viewMonth === today.month && day === today.day
          const isSelected = value === dateStr

          return (
            <button
              key={day}
              onClick={() => handleDayClick(dateStr)}
              className={`
                w-8 h-8 rounded text-xs font-medium transition-all
                ${isToday ? 'ring-1 ring-base-0D ring-offset-1 ring-offset-base-00' : ''}
                ${isSelected ? 'bg-base-0D text-base-00' : 'text-base-05 hover:bg-base-01'}
              `}
            >
              {day}
            </button>
          )
        })}
      </div>
    </div>
  )
}
