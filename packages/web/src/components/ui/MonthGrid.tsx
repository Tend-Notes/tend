// SPDX-License-Identifier: MIT WITH Commons-Clause
// The month calendar shared by the date picker and the journal heatmap.
//
// Both shipped their own copy of this above lib/calendarUtils: identical month
// navigation, the same leading-blank + day-cell loop, the same header with the
// same inline SVG chevrons, the same day-names row. Only the cell contents and
// the surrounding chrome genuinely differ, so the cell is a render prop and the
// chrome stays with each caller.

import { useState, type ReactNode } from 'react'
import {
  getDaysInMonth,
  getFirstDayOfMonth,
  formatCalendarDate,
  todayParts,
  MONTH_NAMES,
  DAY_NAMES,
} from '../../lib/calendarUtils'

export interface MonthGridDay {
  day: number
  dateStr: string
  isToday: boolean
}

interface MonthGridProps {
  /** Month to open on. Defaults to the current month. */
  initialMonth?: { year: number; month: number }
  /** Render one day button. The grid supplies the blanks and the date string. */
  renderDay: (day: MonthGridDay) => ReactNode
  /** Replaces the day grid entirely — the heatmap uses it while loading. */
  gridOverride?: ReactNode
}

export function MonthGrid({ initialMonth, renderDay, gridOverride }: MonthGridProps) {
  const today = todayParts()
  const [viewYear, setViewYear] = useState(initialMonth?.year ?? today.year)
  const [viewMonth, setViewMonth] = useState(initialMonth?.month ?? today.month)

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

  // Day cells, with leading blanks so the 1st lands on its weekday.
  const daysInMonth = getDaysInMonth(viewYear, viewMonth)
  const firstDay = getFirstDayOfMonth(viewYear, viewMonth)
  const dayCells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) dayCells.push(null)
  for (let day = 1; day <= daysInMonth; day++) dayCells.push(day)

  return (
    <>
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
      {gridOverride ?? (
        <div className="grid grid-cols-7 gap-1">
          {dayCells.map((day, index) => {
            if (day === null) {
              return <div key={`empty-${index}`} className="w-8 h-8" />
            }
            const dateStr = formatCalendarDate(viewYear, viewMonth, day)
            const isToday = viewYear === today.year && viewMonth === today.month && day === today.day
            return renderDay({ day, dateStr, isToday })
          })}
        </div>
      )}
    </>
  )
}
