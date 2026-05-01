// SPDX-License-Identifier: MIT WITH Commons-Clause
// Task state management - hoists task fetch from SidebarTodos for shared use

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { todos as todosApi, type TaskItem } from '../lib/api'
import { formatDateYMD } from '../lib/dateUtils'

export type Task = TaskItem

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
}

export const useTaskStore = create<TaskState>()(
  immer((set) => ({
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
  }))
)

let lastPageVersion = usePageStore.getState().currentPage?.version
usePageStore.subscribe((state) => {
  const version = state.currentPage?.version
  if (version !== lastPageVersion) {
    lastPageVersion = version
    void useTaskStore.getState().refresh()
  }
})

void useTaskStore.getState().refresh()
