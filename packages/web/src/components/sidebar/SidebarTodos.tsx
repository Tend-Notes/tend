// SPDX-License-Identifier: MIT WITH Commons-Clause
// Sidebar todos panel - aggregates all tasks across pages

import { useState, useEffect, useMemo } from 'react'
import { todos as todosApi, type TaskItem } from '../../lib/api'
import { usePageStore } from '../../stores/pageStore'
import { useSettingsStore, TASK_STATUS_SETS } from '../../stores/settingsStore'

interface SidebarTodosProps {
  onBack: () => void
}

type FilterMode = 'all' | 'active' | 'completed'
type SortMode = 'status' | 'page'

// Get color for a status keyword
function getStatusColor(status: string): string {
  for (const statuses of Object.values(TASK_STATUS_SETS)) {
    const found = statuses.find(s => s.keyword === status)
    if (found) return found.color
  }
  return 'base-05'
}

// Is this a "completed" status?
function isCompletedStatus(status: string): boolean {
  return status === 'DONE' || status === 'NEVER'
}

export function SidebarTodos({ onBack }: SidebarTodosProps) {
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [hasFetched, setHasFetched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterMode>('active')
  const [sort, setSort] = useState<SortMode>('status')

  const { navigateToPage, navigateToJournal } = usePageStore()
  const taskStatuses = useSettingsStore((state) => state.getTaskStatuses())

  // Fetch tasks from backend
  useEffect(() => {
    let cancelled = false

    async function fetchTasks() {
      try {
        setError(null)
        const data = await todosApi.list()
        if (!cancelled) {
          setTasks(data.tasks)
          setHasFetched(true)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load tasks')
          setHasFetched(true)
        }
      }
    }

    fetchTasks()
    return () => { cancelled = true }
  }, [])

  // Filter tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (filter === 'all') return true
      if (filter === 'active') return !isCompletedStatus(task.status)
      if (filter === 'completed') return isCompletedStatus(task.status)
      return true
    })
  }, [tasks, filter])

  // Sort tasks
  const sortedTasks = useMemo(() => {
    const sorted = [...filteredTasks]

    if (sort === 'status') {
      // Sort by status priority (TODO, DOING first, then by content)
      const statusOrder: Record<string, number> = {
        'NOW': 0,
        'DOING': 1,
        'TODO': 2,
        'LATER': 3,
        'DONE': 4,
        'NEVER': 5,
      }
      sorted.sort((a, b) => {
        const orderA = statusOrder[a.status] ?? 99
        const orderB = statusOrder[b.status] ?? 99
        if (orderA !== orderB) return orderA - orderB
        return a.content.localeCompare(b.content)
      })
    } else if (sort === 'page') {
      // Sort by page name, then by status
      sorted.sort((a, b) => {
        const pageCompare = a.pageTitle.localeCompare(b.pageTitle)
        if (pageCompare !== 0) return pageCompare
        return a.content.localeCompare(b.content)
      })
    }

    return sorted
  }, [filteredTasks, sort])

  // Handle task click - navigate to the page
  const handleTaskClick = (task: TaskItem) => {
    if (task.isJournal && task.journalDate) {
      navigateToJournal(task.journalDate)
    } else {
      navigateToPage(task.pageName)
    }
    // TODO: Scroll to and highlight the specific block
  }

  // Count by status
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const task of tasks) {
      counts[task.status] = (counts[task.status] || 0) + 1
    }
    return counts
  }, [tasks])

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-base-02">
        <button
          onClick={onBack}
          className="p-1 text-base-04 hover:text-base-05 transition-colors"
          title="Back to navigation"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-medium text-base-05">Tasks</span>
        <div className="w-4" />
      </div>

      {/* Filter and sort controls */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-base-02">
        <div className="flex gap-1">
          <button
            onClick={() => setFilter('active')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              filter === 'active'
                ? 'bg-base-02 text-base-05'
                : 'text-base-04 hover:text-base-05'
            }`}
          >
            Active
          </button>
          <button
            onClick={() => setFilter('completed')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              filter === 'completed'
                ? 'bg-base-02 text-base-05'
                : 'text-base-04 hover:text-base-05'
            }`}
          >
            Completed
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              filter === 'all'
                ? 'bg-base-02 text-base-05'
                : 'text-base-04 hover:text-base-05'
            }`}
          >
            All
          </button>
        </div>
        <div className="ml-auto flex gap-1">
          <button
            onClick={() => setSort('status')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              sort === 'status'
                ? 'bg-base-02 text-base-05'
                : 'text-base-04 hover:text-base-05'
            }`}
          >
            By Status
          </button>
          <button
            onClick={() => setSort('page')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              sort === 'page'
                ? 'bg-base-02 text-base-05'
                : 'text-base-04 hover:text-base-05'
            }`}
          >
            By Page
          </button>
        </div>
      </div>

      {/* Status summary */}
      <div className="flex flex-wrap gap-2 px-3 py-2 border-b border-base-02">
        {taskStatuses.map((status) => {
          const count = statusCounts[status.keyword] || 0
          if (count === 0) return null
          return (
            <span
              key={status.keyword}
              className="text-xs px-2 py-0.5 rounded"
              style={{
                backgroundColor: `var(--${status.color})`,
                color: 'var(--base00)',
              }}
            >
              {status.keyword}: {count}
            </span>
          )
        })}
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto p-3">
        {!hasFetched ? (
          null
        ) : error ? (
          <div className="text-center text-base-08 text-sm py-8">{error}</div>
        ) : sortedTasks.length === 0 ? (
          <div className="text-center text-base-04 text-sm py-8">
            {filter === 'active'
              ? 'No active tasks. Use TODO, DOING, or NOW to create tasks.'
              : filter === 'completed'
              ? 'No completed tasks yet.'
              : 'No tasks found.'}
          </div>
        ) : (
          <ul className="space-y-2">
            {sortedTasks.map((task) => {
              const color = getStatusColor(task.status)
              const isCompleted = isCompletedStatus(task.status)

              return (
                <li key={task.uuid}>
                  <button
                    onClick={() => handleTaskClick(task)}
                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-base-01 transition-colors"
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className="text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0"
                        style={{
                          backgroundColor: `var(--${color})`,
                          color: 'var(--base00)',
                        }}
                      >
                        {task.status}
                      </span>
                      <span
                        className={`text-sm flex-1 ${
                          isCompleted ? 'text-base-04 line-through' : 'text-base-05'
                        }`}
                      >
                        {task.content || '(empty)'}
                      </span>
                    </div>
                    <div className="text-xs text-base-04 mt-1 ml-0.5">
                      {task.pageTitle}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
