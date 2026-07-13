// SPDX-License-Identifier: MIT WITH Commons-Clause
// Task state management - hoists task fetch from SidebarTodos for shared use

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { todos as todosApi, blocks as blocksApi, type TaskItem } from '../lib/api'
import type { BlockUpdate } from '../types'
import { formatDateYMD } from '../lib/dateUtils'
import { useToastStore } from './toastStore'

export type Task = TaskItem

// Split a full block content ("DONE buy milk") into keyword + trailing text, for
// optimistic UI updates. Mirrors the backend task regex.
function splitContent(full: string): { status: string; text: string } {
  const m = full.match(/^(TODO|DOING|DONE|NOW|LATER|NEVER)(?:\s+([\s\S]*))?$/)
  if (m) return { status: m[1], text: m[2] ?? '' }
  return { status: '', text: full }
}

function getToday(): string {
  return formatDateYMD(new Date())
}

function getTodayPlusDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return formatDateYMD(d)
}

function isCompleted(task: Task): boolean {
  return task.status === 'DONE' || task.status === 'NEVER'
}

function isActive(task: Task): boolean {
  return !isCompleted(task)
}

// Pure selector functions — take tasks array, return filtered results

export function selectToday(tasks: Task[]): Task[] {
  const today = getToday()
  return tasks.filter(
    (t) => isActive(t) && (t.dueDate === today || t.startDate === today)
  )
}

export function selectOverdue(tasks: Task[]): Task[] {
  const today = getToday()
  return tasks.filter(
    (t) => isActive(t) && !!t.dueDate && t.dueDate < today
  )
}

export function selectDueSoon(tasks: Task[]): Task[] {
  const today = getToday()
  const limit = getTodayPlusDays(7)
  return tasks.filter(
    (t) => isActive(t) && !!t.dueDate && t.dueDate > today && t.dueDate <= limit
  )
}

export function selectStartingSoon(tasks: Task[]): Task[] {
  const today = getToday()
  const limit = getTodayPlusDays(7)
  return tasks.filter(
    (t) => isActive(t) && !!t.startDate && t.startDate > today && t.startDate <= limit
  )
}

export function selectNoDueDate(tasks: Task[]): Task[] {
  return tasks.filter((t) => isActive(t) && !t.dueDate)
}

export function selectAllActive(tasks: Task[]): Task[] {
  return tasks.filter(isActive)
}

export function selectCompleted(tasks: Task[]): Task[] {
  return tasks.filter(isCompleted)
}

export function selectBadgeCount(tasks: Task[]): number {
  const today = getToday()
  return tasks.filter(
    (t) => isActive(t) && ((!!t.dueDate && t.dueDate <= today) || t.startDate === today)
  ).length
}

import { usePageStore } from './pageStore'

// Store

interface TaskState {
  tasks: Task[]
  loading: boolean
  error: string | null

  refresh: () => Promise<void>
  // Update a task's block by uuid (status/content via `content`, priority/dates
  // via `properties`) on its origin page, then reconcile from the server.
  updateTask: (uuid: string, patch: BlockUpdate) => Promise<void>
}

export const useTaskStore = create<TaskState>()(
  immer((set, get) => ({
    tasks: [],
    loading: false,
    error: null,

    refresh: async () => {
      set((state) => {
        state.loading = true
        state.error = null
      })
      try {
        const data = await todosApi.list()
        set((state) => {
          state.tasks = data.tasks
          state.loading = false
        })
      } catch (err) {
        set((state) => {
          state.error = err instanceof Error ? err.message : String(err)
          state.loading = false
        })
      }
    },

    updateTask: async (uuid, patch) => {
      // The task carries its origin page (from /todos); pass it so the server can
      // locate the block without the block index (works on encrypted gardens).
      const pageName = get().tasks.find((x) => x.uuid === uuid)?.pageName
      // Optimistically reflect the edit so the row updates immediately; refresh
      // below reconciles with (or reverts to) server truth.
      set((state) => {
        const t = state.tasks.find((x) => x.uuid === uuid)
        if (!t) return
        if (patch.content !== undefined) {
          const { status, text } = splitContent(patch.content)
          if (status) t.status = status
          t.content = text
        }
        if (patch.properties) {
          for (const [key, value] of Object.entries(patch.properties)) {
            if (key === 'priority') t.priority = value
            else if (key === 'due_date') t.dueDate = value
            else if (key === 'start_date') t.startDate = value
          }
        }
      })
      try {
        await blocksApi.update(uuid, { ...patch, pageName })
      } catch (err) {
        // Surface the failure instead of silently snapping the row back.
        useToastStore
          .getState()
          .addToast(`Couldn't update task: ${err instanceof Error ? err.message : String(err)}`, 4000)
      } finally {
        await get().refresh()
      }
    },
  }))
)

// currentPage.version bumps on every save (i.e. every keystroke burst), and
// refresh() refetches ALL tasks across ALL pages. Debounce so a burst of saves
// triggers a single refetch after typing settles, instead of one per save.
let lastPageVersion = usePageStore.getState().currentPage?.version
let taskRefreshTimer: ReturnType<typeof setTimeout> | undefined
usePageStore.subscribe((state) => {
  const version = state.currentPage?.version
  if (version !== lastPageVersion) {
    lastPageVersion = version
    if (taskRefreshTimer) clearTimeout(taskRefreshTimer)
    taskRefreshTimer = setTimeout(() => {
      void useTaskStore.getState().refresh()
    }, 800)
  }
})

// Initial load: the sidebar todo count is shown on cold load, so fetch once.
void useTaskStore.getState().refresh()
