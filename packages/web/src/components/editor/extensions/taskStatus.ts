// SPDX-License-Identifier: MIT WITH Commons-Clause
// Task status extension for the editor
//
// Renders task status keywords (TODO, DOING, DONE, etc.) at the start of
// blocks as colored badges. The keyword is replaced with a styled badge
// that matches the configured task status set.

import {
  EditorView,
  Decoration,
  DecorationSet,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { Extension, Range } from '@codemirror/state'
import { TASK_STATUS_SETS, type TaskStatusSet } from '../../../stores/settingsStore'

// Build regex to match task status keywords at start of content
function buildTaskStatusRegex(statusSet: TaskStatusSet): RegExp {
  const statuses = TASK_STATUS_SETS[statusSet]
  const keywords = statuses.map((s) => s.keyword)
  // Match keyword at start, followed by whitespace
  return new RegExp(`^(${keywords.join('|')})\\s`)
}

// Get status info for a keyword
function getStatusInfo(
  keyword: string,
  statusSet: TaskStatusSet
): { color: string; label: string } | null {
  const statuses = TASK_STATUS_SETS[statusSet]
  const status = statuses.find((s) => s.keyword === keyword)
  return status ? { color: status.color, label: status.label } : null
}

// Get the next status keyword in the cycle
function getNextStatus(currentKeyword: string, statusSet: TaskStatusSet): string {
  const statuses = TASK_STATUS_SETS[statusSet]
  const currentIndex = statuses.findIndex((s) => s.keyword === currentKeyword)
  const nextIndex = (currentIndex + 1) % statuses.length
  return statuses[nextIndex].keyword
}

// Widget that renders the task status badge
class TaskStatusWidget extends WidgetType {
  constructor(
    readonly keyword: string,
    readonly color: string,
    readonly isDone: boolean,
    readonly statusSet: TaskStatusSet
  ) {
    super()
  }

  toDOM(view: EditorView): HTMLElement {
    const badge = document.createElement('span')
    badge.className = 'task-status-badge'
    badge.textContent = this.keyword
    // Convert 'base-0A' to 'base0A' for CSS variable
    const cssColor = this.color.replace('-', '')
    badge.style.cssText = `
      display: inline-block;
      padding: 1px 6px;
      margin-right: 6px;
      font-size: 0.75em;
      font-weight: 600;
      border-radius: 3px;
      background-color: var(--${cssColor}, #666);
      color: var(--base00, #fff);
      cursor: pointer;
      user-select: none;
    `
    badge.title = 'Click to cycle status'

    badge.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const nextKeyword = getNextStatus(this.keyword, this.statusSet)
      view.dispatch({
        changes: {
          from: 0,
          to: this.keyword.length,
          insert: nextKeyword,
        },
      })
    })

    return badge
  }

  eq(other: TaskStatusWidget): boolean {
    return other.keyword === this.keyword && other.color === this.color
  }

  ignoreEvent(): boolean {
    // Allow click events to pass through
    return false
  }
}

// Build decorations for task status keywords
function buildTaskDecorations(
  view: EditorView,
  statusSet: TaskStatusSet
): DecorationSet {
  const decorations: Range<Decoration>[] = []
  const regex = buildTaskStatusRegex(statusSet)
  const doc = view.state.doc

  // Check start of document for task status
  const text = doc.toString()
  const match = text.match(regex)

  if (match) {
    const keyword = match[1]
    const info = getStatusInfo(keyword, statusSet)

    if (info) {
      const keywordEnd = keyword.length
      const isDone = keyword === 'DONE' || keyword === 'NEVER'

      // Replace the keyword with a widget
      decorations.push(
        Decoration.replace({
          widget: new TaskStatusWidget(keyword, info.color, isDone, statusSet),
        }).range(0, keywordEnd)
      )

      // If DONE, apply strikethrough to the rest of the line
      if (isDone) {
        const lineEnd = doc.line(1).to
        if (keywordEnd + 1 < lineEnd) {
          decorations.push(
            Decoration.mark({ class: 'task-done-content' }).range(
              keywordEnd + 1,
              lineEnd
            )
          )
        }
      }
    }
  }

  return Decoration.set(decorations)
}

// ViewPlugin that manages task status decorations
function createTaskStatusPlugin(statusSet: TaskStatusSet) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildTaskDecorations(view, statusSet)
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.decorations = buildTaskDecorations(update.view, statusSet)
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  )
}

// Theme for task status styling
const taskStatusTheme = EditorView.baseTheme({
  '.task-done-content': {
    textDecoration: 'line-through',
    opacity: '0.6',
  },
})

/**
 * Extension that renders task status keywords as colored badges.
 * @param statusSet - The task status set to use (e.g., 'todo-doing-done')
 */
export function taskStatus(statusSet: TaskStatusSet = 'todo-doing-done'): Extension {
  return [createTaskStatusPlugin(statusSet), taskStatusTheme]
}
