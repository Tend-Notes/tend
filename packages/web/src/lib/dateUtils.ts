// SPDX-License-Identifier: MIT WITH Commons-Clause
// Date utilities for task metadata

import type { CSSProperties } from 'react'

/**
 * Format a date string (YYYY-MM-DD) for display.
 * Returns "Today", "Tomorrow", "Yesterday", or "Jan 15" format.
 */
export function formatShortDate(dateStr: string): string {
  const date = parseDate(dateStr)
  if (!date) return dateStr

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.getTime() === today.getTime()) {
    return 'Today'
  }
  if (date.getTime() === tomorrow.getTime()) {
    return 'Tomorrow'
  }
  if (date.getTime() === yesterday.getTime()) {
    return 'Yesterday'
  }

  // Format as "Jan 15" or "Jan 15, 2025" if different year
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const month = months[date.getMonth()]
  const day = date.getDate()
  const year = date.getFullYear()

  if (year !== today.getFullYear()) {
    return `${month} ${day}, ${year}`
  }
  return `${month} ${day}`
}

/**
 * Parse a YYYY-MM-DD string into a Date object (midnight local time).
 * Returns null if invalid.
 */
export function parseDate(dateStr: string): Date | null {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null

  const year = parseInt(match[1], 10)
  const month = parseInt(match[2], 10) - 1
  const day = parseInt(match[3], 10)

  const date = new Date(year, month, day)
  // Validate the date is real (e.g., not Feb 30)
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null
  }
  return date
}

/**
 * Format a Date object as YYYY-MM-DD.
 */
export function formatDateYMD(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Check if a due date is overdue (past today).
 */
export function isOverdue(dateStr: string): boolean {
  const date = parseDate(dateStr)
  if (!date) return false

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return date.getTime() < today.getTime()
}

/**
 * Check if a due date is today.
 */
export function isDueToday(dateStr: string): boolean {
  const date = parseDate(dateStr)
  if (!date) return false

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return date.getTime() === today.getTime()
}

/**
 * Get days from today to the due date.
 * Negative = past due, 0 = today, positive = future.
 */
export function getDaysFromDue(dateStr: string): number {
  const date = parseDate(dateStr)
  if (!date) return 0

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const diffMs = date.getTime() - today.getTime()
  return Math.round(diffMs / (1000 * 60 * 60 * 24))
}

/**
 * Get urgency level from days from due.
 * Returns a value from -7 to +7, clamped.
 * Negative = approaching due (e.g., -3 means due in 3 days)
 * Zero = due today
 * Positive = overdue (e.g., +3 means 3 days overdue)
 */
export function getUrgencyLevel(dateStr: string): number {
  const days = getDaysFromDue(dateStr)
  // Invert: negative days means future (approaching), positive means past (overdue)
  const urgency = -days
  return Math.max(-7, Math.min(7, urgency))
}

/**
 * Get CSS classes/styles for urgency visualization.
 * Returns an object with style properties.
 *
 * Urgency gradient:
 * - t-7 to t-0: Incrementally bolder as due date approaches
 * - t-0: Maximum pre-due emphasis
 * - t+1 to t+7: Increasingly red after due date
 */
export function getUrgencyStyle(dateStr: string): {
  className: string
  style: CSSProperties
} {
  const urgency = getUrgencyLevel(dateStr)

  // Not approaching yet (more than 7 days away)
  if (urgency < -7) {
    return { className: '', style: {} }
  }

  // Approaching: -7 to 0
  if (urgency <= 0) {
    // Map -7..0 to 0..1 opacity
    const intensity = (urgency + 7) / 7
    const isMaxUrgency = urgency === 0
    return {
      className: 'task-due-approaching',
      style: {
        // Use base0E (yellow) for approaching, with increasing intensity
        color: `color-mix(in srgb, var(--base0E) ${Math.round(intensity * 100)}%, var(--base05))`,
        fontWeight: intensity > 0.5 ? 500 : 400,
        // Max urgency (due today): add pill background
        ...(isMaxUrgency && {
          backgroundColor: 'color-mix(in srgb, var(--base0E) 15%, transparent)',
          padding: '2px 6px',
          borderRadius: '4px',
        }),
      },
    }
  }

  // Overdue: 1 to 7+
  const intensity = Math.min(urgency / 7, 1)
  const isMaxUrgency = urgency >= 7
  return {
    className: 'task-overdue',
    style: {
      // Use base08 (red) for overdue, with increasing intensity
      color: `color-mix(in srgb, var(--base08) ${Math.round(intensity * 100)}%, var(--base05))`,
      fontWeight: 500,
      // Max urgency (7+ days overdue): add pill background
      ...(isMaxUrgency && {
        backgroundColor: 'color-mix(in srgb, var(--base08) 15%, transparent)',
        padding: '2px 6px',
        borderRadius: '4px',
      }),
    },
  }
}

/**
 * Get date offset from today.
 */
export function getDateOffset(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return formatDateYMD(date)
}

/**
 * Get the start of next week (Monday).
 */
export function getNextMonday(): string {
  const today = new Date()
  const dayOfWeek = today.getDay()
  // Days until Monday: if Sunday (0) -> 1, Monday (1) -> 7, Tuesday (2) -> 6, etc.
  const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek
  today.setDate(today.getDate() + daysUntilMonday)
  return formatDateYMD(today)
}

/**
 * Get the first day of next month.
 */
export function getNextMonth(): string {
  const today = new Date()
  today.setMonth(today.getMonth() + 1)
  today.setDate(1)
  return formatDateYMD(today)
}
