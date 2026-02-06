// SPDX-License-Identifier: MIT WITH Commons-Clause
// Priority picker popover for task priority

import { useRef } from 'react'
import { useClickOutside } from '../../hooks/useClickOutside'
import { useEscapeKey } from '../../hooks/useEscapeKey'

interface PriorityPickerPopoverProps {
  value: string | null
  onChange: (priority: string | null) => void
  onClose: () => void
}

const PRIORITIES = [
  { value: null, label: 'None', indicator: '', color: 'var(--base-04)' },
  { value: '1', label: 'Low', indicator: '!', color: 'var(--base-0B)' },
  { value: '2', label: 'Medium', indicator: '!!', color: 'var(--base-0A)' },
  { value: '3', label: 'High', indicator: '!!!', color: 'var(--base-08)' },
]

export function PriorityPickerPopover({ value, onChange, onClose }: PriorityPickerPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)

  useClickOutside(popoverRef, onClose)
  useEscapeKey(onClose)

  const handleSelect = (priorityValue: string | null) => {
    onChange(priorityValue)
    onClose()
  }

  return (
    <div
      ref={popoverRef}
      className="absolute z-50 bg-base-00 border border-base-02 rounded-lg shadow-lg py-1 w-[140px]"
      style={{ top: '100%', left: 0, marginTop: '4px' }}
    >
      {PRIORITIES.map((priority) => {
        const isSelected = value === priority.value
        return (
          <button
            key={priority.label}
            onClick={() => handleSelect(priority.value)}
            className={`
              w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 transition-colors
              ${isSelected ? 'bg-base-02' : 'hover:bg-base-01'}
            `}
          >
            <span
              className="w-6 text-center font-bold"
              style={{ color: priority.color }}
            >
              {priority.indicator || '-'}
            </span>
            <span className="text-base-05">{priority.label}</span>
            {isSelected && (
              <svg className="w-3 h-3 ml-auto text-base-0D" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Get display text for a priority value.
 */
export function getPriorityDisplay(priority: string | null): { indicator: string; label: string; color: string } {
  const found = PRIORITIES.find((p) => p.value === priority)
  return found || PRIORITIES[0]
}
