// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Shared task-status helpers, used by the editor badge and the task manager so
// the cycle order and the content/keyword rewrite live in one place. A task is a
// block whose content begins with a status keyword; the keyword is stored in
// block.content while the task list carries status + the trailing text separately.

import { TASK_STATUS_SETS } from '../stores/settingsStore'
import type { TaskItem } from './api'

// The next keyword when cycling, within whichever set this keyword belongs to.
export function nextStatusKeyword(keyword: string): string | null {
  for (const set of Object.values(TASK_STATUS_SETS)) {
    const i = set.findIndex((s) => s.keyword === keyword)
    if (i >= 0) return set[(i + 1) % set.length].keyword
  }
  return null
}

// Build the full block content for a task with a new status keyword (text kept).
export function taskContentWithStatus(task: Pick<TaskItem, 'content'>, keyword: string): string {
  return `${keyword} ${task.content}`.trimEnd()
}

// Build the full block content for a task with new text (status kept).
export function taskContentWithText(task: Pick<TaskItem, 'status'>, text: string): string {
  return `${task.status} ${text}`.trimEnd()
}

// The CSS variable name (no leading `--`) for a status keyword's color, matching
// the editor badge (e.g. 'TODO' -> 'base0A'). Falls back to base03.
export function statusColorVar(keyword: string): string {
  for (const set of Object.values(TASK_STATUS_SETS)) {
    const s = set.find((x) => x.keyword === keyword)
    if (s) return s.color.replace('-', '')
  }
  return 'base03'
}
