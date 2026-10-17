// SPDX-License-Identifier: MIT WITH Commons-Clause
// Date picker popover for task due dates and start dates

import { useState, useRef, useMemo, useLayoutEffect } from 'react'
import { formatDateYMD, getDateOffset, getNextMonday, getNextMonth } from '../../lib/dateUtils'
import { parseCalendarDate, todayParts } from '../../lib/calendarUtils'
import { MonthGrid } from './MonthGrid'
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
  const today = useMemo(() => todayParts(), [])

  const todayStr = formatDateYMD(new Date())

  // Initialize view to the selected date or today
  const initialDate = useMemo(() => {
    if (value) {
      return parseCalendarDate(value)
    }
    return today
  }, [value, today])

  useClickOutside(popoverRef, onClose)
  useEscapeKey(onClose)

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

      <MonthGrid
        initialMonth={initialDate}
        renderDay={({ day, dateStr, isToday }) => {
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
        }}
      />
    </div>
  )
}
