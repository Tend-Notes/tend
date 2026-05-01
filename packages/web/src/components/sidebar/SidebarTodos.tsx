// SPDX-License-Identifier: MIT WITH Commons-Clause
// Sidebar todos panel - aggregates all tasks across pages

import { useState, useEffect, useMemo } from 'react'
import { type TaskItem } from '../../lib/api'
import { useTaskStore } from '../../stores/taskStore'
import { usePageStore } from '../../stores/pageStore'
import { useSettingsStore, TASK_STATUS_SETS } from '../../stores/settingsStore'
import { useUIStore, type TodoFilterMode } from '../../stores/uiStore'
import { formatShortDate, formatDateYMD, getUrgencyStyle, getDaysFromDue } from '../../lib/dateUtils'
import { getPriorityDisplay } from '../ui/PriorityPickerPopover'
import { renderContentWithWikilinks } from '../../lib/renderTaskContent'

interface SidebarTodosProps {
  onBack: () => void
}

type FilterMode = TodoFilterMode
type SortMode = 'status' | 'page' | 'due' | 'priority'

// Get color for a status keyword
// Returns CSS variable name like 'base0A' (without hyphen, for use as --base0A)
function getStatusColor(status: string): string {
  for (const statuses of Object.values(TASK_STATUS_SETS)) {
    const found = statuses.find(s => s.keyword === status)
    if (found) {
      // Convert 'base-0A' to 'base0A' for CSS variable
      return found.color.replace('-', '')
    }
  }
  return 'base05'
}

// Is this a "completed" status?
function isCompletedStatus(status: string): boolean {
  return status === 'DONE' || status === 'NEVER'
}


export function SidebarTodos({ onBack }: SidebarTodosProps) {
  const tasks = useTaskStore((s) => s.tasks)
  const loading = useTaskStore((s) => s.loading)
  const error = useTaskStore((s) => s.error)
  const [sort, setSort] = useState<SortMode>('status')

  // Read initial filter from uiStore (set by sidebar navigation task counts)
  const todoFilter = useUIStore((state) => state.todoFilter)
  const setTodoFilter = useUIStore((state) => state.setTodoFilter)
  const [filter, setFilter] = useState<FilterMode>(todoFilter ?? 'active')

  // Sync filter when todoFilter changes (e.g., clicking "Today" or "Overdue" in nav)
  useEffect(() => {
    if (todoFilter) {
      setFilter(todoFilter)
      // Also set sort to 'due' for date-based filters
      if (todoFilter === 'today' || todoFilter === 'overdue') {
        setSort('due')
      }
      // Clear the store filter so it doesn't re-apply on re-renders
      setTodoFilter(null)
    }
  }, [todoFilter, setTodoFilter])

  const { navigateToPage, navigateToJournal, setPendingScrollTarget } = usePageStore()
  const taskStatuses = useSettingsStore((state) => state.getTaskStatuses())

  // Filter tasks
  const filteredTasks = useMemo(() => {
    const todayStr = formatDateYMD(new Date())
    return tasks.filter((task) => {
      if (filter === 'all') return true
      if (filter === 'active') return !isCompletedStatus(task.status)
      if (filter === 'completed') return isCompletedStatus(task.status)
      if (filter === 'today') {
        // Tasks with due_date = today OR start_date = today (active only)
        if (isCompletedStatus(task.status)) return false
        return task.dueDate === todayStr || task.startDate === todayStr
      }
      if (filter === 'overdue') {
        // Tasks with due_date < today that are not completed
        if (isCompletedStatus(task.status)) return false
        if (!task.dueDate) return false
        return task.dueDate < todayStr
      }
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
    } else if (sort === 'due') {
      // Sort by due date (soonest first, no date last)
      sorted.sort((a, b) => {
        // Tasks without due date go to the end
        if (!a.dueDate && !b.dueDate) return a.content.localeCompare(b.content)
        if (!a.dueDate) return 1
        if (!b.dueDate) return -1
        // Sort by due date (earlier = higher priority)
        const dateCompare = a.dueDate.localeCompare(b.dueDate)
        if (dateCompare !== 0) return dateCompare
        return a.content.localeCompare(b.content)
      })
    } else if (sort === 'priority') {
      // Sort by priority (highest first, no priority last)
      sorted.sort((a, b) => {
        // Tasks without priority go to the end
        if (!a.priority && !b.priority) return a.content.localeCompare(b.content)
        if (!a.priority) return 1
        if (!b.priority) return -1
        // Sort by priority (3 = high > 2 = medium > 1 = low)
        const priorityA = parseInt(a.priority, 10)
        const priorityB = parseInt(b.priority, 10)
        if (priorityB !== priorityA) return priorityB - priorityA
        return a.content.localeCompare(b.content)
      })
    }

    return sorted
  }, [filteredTasks, sort])

  // Handle task click - navigate to the page and scroll to block
  const handleTaskClick = (task: TaskItem) => {
    // Set scroll target before navigation
    setPendingScrollTarget(task.uuid)

    if (task.isJournal && task.journalDate) {
      navigateToJournal(task.journalDate)
    } else {
      navigateToPage(task.pageName)
    }
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
        <div className="flex gap-1 flex-wrap">
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
            onClick={() => setFilter('today')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              filter === 'today'
                ? 'bg-base-02 text-base-05'
                : 'text-base-04 hover:text-base-05'
            }`}
          >
            Today
          </button>
          <button
            onClick={() => setFilter('overdue')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              filter === 'overdue'
                ? 'bg-base-02 text-base-05'
                : 'text-base-04 hover:text-base-05'
            }`}
          >
            Overdue
          </button>
          <button
            onClick={() => setFilter('completed')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              filter === 'completed'
                ? 'bg-base-02 text-base-05'
                : 'text-base-04 hover:text-base-05'
            }`}
          >
            Done
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
            Status
          </button>
          <button
            onClick={() => setSort('due')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              sort === 'due'
                ? 'bg-base-02 text-base-05'
                : 'text-base-04 hover:text-base-05'
            }`}
          >
            Due
          </button>
          <button
            onClick={() => setSort('priority')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              sort === 'priority'
                ? 'bg-base-02 text-base-05'
                : 'text-base-04 hover:text-base-05'
            }`}
          >
            Priority
          </button>
          <button
            onClick={() => setSort('page')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              sort === 'page'
                ? 'bg-base-02 text-base-05'
                : 'text-base-04 hover:text-base-05'
            }`}
          >
            Page
          </button>
        </div>
      </div>

      {/* Status summary */}
      <div className="flex flex-wrap gap-2 px-3 py-2 border-b border-base-02">
        {taskStatuses.map((status) => {
          const count = statusCounts[status.keyword] || 0
          if (count === 0) return null
          // Convert 'base-0A' to 'base0A' for CSS variable
          const cssColor = status.color.replace('-', '')
          return (
            <span
              key={status.keyword}
              className="text-xs px-2 py-0.5 rounded"
              style={{
                backgroundColor: `var(--${cssColor})`,
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
        {loading && tasks.length === 0 ? (
          null
        ) : error ? (
          <div className="text-center text-base-08 text-sm py-8">{error}</div>
        ) : sortedTasks.length === 0 ? (
          <div className="text-center text-base-04 text-sm py-8">
            {filter === 'active'
              ? 'No active tasks. Use TODO, DOING, or NOW to create tasks.'
              : filter === 'today'
              ? 'No tasks due or starting today.'
              : filter === 'overdue'
              ? 'No overdue tasks.'
              : filter === 'completed'
              ? 'No completed tasks yet.'
              : 'No tasks found.'}
          </div>
        ) : (
          <ul className="space-y-2">
            {sortedTasks.map((task) => {
              const color = getStatusColor(task.status)
              const isCompleted = isCompletedStatus(task.status)
              const priorityInfo = task.priority ? getPriorityDisplay(task.priority) : null
              // Urgency based on start date if set, otherwise due date
              // Completed tasks don't show urgency styling
              const urgencyDate = task.startDate || task.dueDate
              const urgencyStyle = urgencyDate && !isCompleted ? getUrgencyStyle(urgencyDate) : null
              const daysFromDue = task.dueDate ? getDaysFromDue(task.dueDate) : null

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
                        {task.content
                          ? renderContentWithWikilinks(task.content, navigateToPage, navigateToJournal)
                          : '(empty)'}
                      </span>
                      {/* Priority indicator */}
                      {priorityInfo && (
                        <span
                          className="text-xs font-bold flex-shrink-0"
                          style={{ color: priorityInfo.color }}
                          title={`Priority: ${priorityInfo.label}`}
                        >
                          {priorityInfo.indicator}
                        </span>
                      )}
                    </div>
                    {/* Page title and due date */}
                    <div className="flex items-center gap-2 mt-1 ml-0.5">
                      <span className="text-xs text-base-04">
                        {task.pageTitle}
                      </span>
                      {task.startDate && (
                        <span
                          className="text-xs"
                          style={urgencyStyle?.style}
                          title={`Start: ${task.startDate}`}
                        >
                          Start: {formatShortDate(task.startDate)}
                        </span>
                      )}
                      {task.dueDate && (
                        <span
                          className="text-xs"
                          style={!task.startDate ? urgencyStyle?.style : undefined}
                          title={daysFromDue !== null && daysFromDue < 0
                            ? `${Math.abs(daysFromDue)} day${Math.abs(daysFromDue) === 1 ? '' : 's'} overdue`
                            : daysFromDue === 0
                            ? 'Due today'
                            : `Due in ${daysFromDue} day${daysFromDue === 1 ? '' : 's'}`
                          }
                        >
                          Due: {formatShortDate(task.dueDate)}
                        </span>
                      )}
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
