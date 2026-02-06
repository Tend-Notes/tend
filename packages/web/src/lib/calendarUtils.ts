// SPDX-License-Identifier: MIT WITH Commons-Clause
// Shared calendar utilities for calendar grid components

/**
 * Get the number of days in a month.
 * @param year - The year (e.g., 2026)
 * @param month - The month (0-indexed, 0 = January, 11 = December)
 */
export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

/**
 * Get the day of week for the first day of a month.
 * @param year - The year (e.g., 2026)
 * @param month - The month (0-indexed, 0 = January, 11 = December)
 * @returns Day of week (0 = Sunday, 6 = Saturday)
 */
export function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay()
}

/**
 * Full month names for calendar headers.
 */
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
] as const

/**
 * Abbreviated day names for calendar column headers.
 */
export const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const

/**
 * Format a date as YYYY-MM-DD.
 * @param year - The year
 * @param month - The month (0-indexed)
 * @param day - The day of month
 */
export function formatCalendarDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Parse a YYYY-MM-DD string into year, month, and day components.
 * @param dateStr - Date string in YYYY-MM-DD format
 * @returns Object with year, month (0-indexed), and day
 */
export function parseCalendarDate(dateStr: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateStr.split('-').map(Number)
  return { year, month: month - 1, day }
}
