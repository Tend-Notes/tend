// SPDX-License-Identifier: MIT WITH Commons-Clause
// Heatmap calendar component for journal navigation

import { useMemo, useState, useRef, useEffect } from 'react'
import { journals as journalsApi } from '../../lib/api'
import { usePageStore } from '../../stores/pageStore'
import type { PageMeta } from '../../types'

interface HeatmapCalendarProps {
  onClose: () => void
  currentDate?: string // YYYY-MM-DD format
}

// Get the number of days in a month
function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

// Get the day of week for the first day of a month (0 = Sunday)
function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay()
}

// Format date as YYYY-MM-DD
function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// Parse YYYY-MM-DD to { year, month, day }
function parseDate(dateStr: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateStr.split('-').map(Number)
  return { year, month: month - 1, day }
}

// Get intensity level (0-4) based on block count
function getIntensityLevel(blockCount: number): number {
  if (blockCount === 0) return 0
  if (blockCount <= 3) return 1
  if (blockCount <= 10) return 2
  if (blockCount <= 25) return 3
  return 4
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

export function HeatmapCalendar({ onClose, currentDate }: HeatmapCalendarProps) {
  const { navigateToJournal } = usePageStore()
  const [journals, setJournals] = useState<PageMeta[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Parse current date or use today
  const today = useMemo(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() }
  }, [])

  const initialDate = currentDate ? parseDate(currentDate) : today
  const [viewYear, setViewYear] = useState(initialDate.year)
  const [viewMonth, setViewMonth] = useState(initialDate.month)

  // Fetch journals on mount
  useEffect(() => {
    async function fetchJournals() {
      try {
        const data = await journalsApi.list()
        setJournals(data)
      } catch (err) {
        console.error('Failed to fetch journals:', err)
      } finally {
        setIsLoading(false)
      }
    }
    fetchJournals()
  }, [])

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Build a map of date -> blockCount for quick lookup
  const journalMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const journal of journals) {
      if (journal.journalDate) {
        map.set(journal.journalDate, journal.blockCount)
      }
    }
    return map
  }, [journals])

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
    navigateToJournal(dateStr)
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

  // Intensity colors using base16 theme
  const intensityColors = [
    'var(--base01)', // level 0 - no content
    'var(--base0B)', // level 1 - light green (opacity controlled by class)
    'var(--base0B)', // level 2
    'var(--base0B)', // level 3
    'var(--base0B)', // level 4 - full green
  ]

  const intensityOpacity = [0.15, 0.3, 0.5, 0.75, 1]

  return (
    <div
      ref={popoverRef}
      className="absolute z-50 bg-base-00 border border-base-02 rounded-lg shadow-lg p-3 w-[280px]"
      style={{ top: '100%', left: 0, marginTop: '4px' }}
    >
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
      {isLoading ? (
        <div className="h-[180px] flex items-center justify-center text-base-04 text-sm">
          Loading...
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {dayCells.map((day, index) => {
            if (day === null) {
              return <div key={`empty-${index}`} className="w-8 h-8" />
            }

            const dateStr = formatDate(viewYear, viewMonth, day)
            const blockCount = journalMap.get(dateStr) || 0
            const intensity = getIntensityLevel(blockCount)
            const hasContent = blockCount > 0
            const isToday = viewYear === today.year && viewMonth === today.month && day === today.day
            const isSelected = currentDate === dateStr

            return (
              <button
                key={day}
                onClick={() => handleDayClick(dateStr)}
                className={`
                  w-8 h-8 rounded text-xs font-medium transition-all
                  ${isToday ? 'ring-1 ring-base-0D ring-offset-1 ring-offset-base-00' : ''}
                  ${isSelected ? 'ring-2 ring-base-0E' : ''}
                  ${hasContent ? 'hover:ring-1 hover:ring-base-04' : 'hover:bg-base-01'}
                `}
                style={{
                  backgroundColor: intensityColors[intensity],
                  opacity: hasContent ? intensityOpacity[intensity] : 1,
                  color: hasContent && intensity >= 2 ? 'var(--base00)' : 'var(--base05)',
                }}
                title={hasContent ? `${blockCount} block${blockCount === 1 ? '' : 's'}` : 'No journal entry'}
              >
                {day}
              </button>
            )
          })}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center justify-end gap-1 mt-3 text-xs text-base-04">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <div
            key={level}
            className="w-3 h-3 rounded-sm"
            style={{
              backgroundColor: level === 0 ? 'var(--base01)' : 'var(--base0B)',
              opacity: level === 0 ? 1 : intensityOpacity[level],
            }}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  )
}
