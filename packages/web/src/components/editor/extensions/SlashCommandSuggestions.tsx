// SPDX-License-Identifier: MIT WITH Commons-Clause
// Slash command suggestions popup component
//
// Renders as a floating popup when user types /
// Shows filtered list of commands and allows selection

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { EditorView } from '@codemirror/view'
import { useSettingsStore, TASK_STATUS_SETS } from '../../../stores/settingsStore'
import { useUIStore } from '../../../stores/uiStore'
import type { SlashCommandState } from './slashCommand'
import { completeSlashCommand, cancelSlashCommand } from './slashCommand'

interface SlashCommandSuggestionsProps {
  view: EditorView
  state: SlashCommandState
}

interface CommandItem {
  id: string
  label: string
  description: string
  action: () => string // Returns the text to insert
  isContentType?: boolean
  contentTypeId?: string
}

export function SlashCommandSuggestions({ view, state }: SlashCommandSuggestionsProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const popupRef = useRef<HTMLDivElement>(null)
  const taskStatusSet = useSettingsStore((s) => s.taskStatusSet)
  const contentTypes = useSettingsStore((s) => s.contentTypes)
  const { openCommandPaletteForContentType } = useUIStore()

  // Custom content types (excluding built-in page and journal)
  const customContentTypes = contentTypes.filter(ct => ct.id !== 'page' && ct.id !== 'journal')

  // Build the list of commands
  const commands = useMemo(() => {
    const items: CommandItem[] = []

    // Task statuses
    const statuses = TASK_STATUS_SETS[taskStatusSet]
    for (const status of statuses) {
      items.push({
        id: status.keyword.toLowerCase(),
        label: status.keyword,
        description: `Create a ${status.keyword} task`,
        action: () => `${status.keyword} `,
      })
    }

    // Content type creation commands
    for (const ct of customContentTypes) {
      items.push({
        id: `new-${ct.id}`,
        label: `New ${ct.name}`,
        description: `Create a new ${ct.name.toLowerCase()} and insert link`,
        action: () => '', // Handled specially
        isContentType: true,
        contentTypeId: ct.id,
      })
    }

    // Standard commands
    items.push(
      {
        id: 'h1',
        label: 'Heading 1',
        description: 'Large section heading',
        action: () => '# ',
      },
      {
        id: 'h2',
        label: 'Heading 2',
        description: 'Medium section heading',
        action: () => '## ',
      },
      {
        id: 'h3',
        label: 'Heading 3',
        description: 'Small section heading',
        action: () => '### ',
      },
      {
        id: 'code',
        label: 'Code Block',
        description: 'Insert a code block',
        action: () => '```\n',
      },
      {
        id: 'quote',
        label: 'Quote',
        description: 'Insert a blockquote',
        action: () => '> ',
      },
      {
        id: 'hr',
        label: 'Divider',
        description: 'Insert a horizontal rule',
        action: () => '---\n',
      },
      {
        id: 'date',
        label: "Today's Date",
        description: 'Insert link to today\'s journal',
        action: () => {
          const today = new Date().toISOString().split('T')[0]
          return `[[journals/${today}]] `
        },
      },
      {
        id: 'time',
        label: 'Current Time',
        description: 'Insert current time',
        action: () => {
          const now = new Date()
          return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' '
        },
      }
    )

    return items
  }, [taskStatusSet, customContentTypes])

  // Filter by query
  const filteredCommands = useMemo(() => {
    const query = state.query.toLowerCase()
    if (!query) return commands

    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(query) ||
        cmd.id.toLowerCase().includes(query)
    )
  }, [commands, state.query])

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [state.query])

  // Handle selection
  const handleSelect = useCallback((cmd: CommandItem) => {
    if (cmd.isContentType && cmd.contentTypeId) {
      // For content type commands, open command palette with the content type
      const ct = contentTypes.find(c => c.id === cmd.contentTypeId)
      if (ct) {
        // Remove the slash command text first
        cancelSlashCommand(view, state)
        // Open command palette to create the sheet, with callback to insert link
        openCommandPaletteForContentType(ct, (link) => {
          // Insert the link at cursor position and restore focus
          const pos = view.state.selection.main.head
          view.dispatch({
            changes: { from: pos, insert: link },
            selection: { anchor: pos + link.length },
          })
          // Restore focus to the editor after command palette closes
          view.focus()
        })
      }
    } else {
      // Regular command - insert the result
      const result = cmd.action()
      completeSlashCommand(view, state, result)
    }
  }, [view, state, contentTypes, openCommandPaletteForContentType])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        setSelectedIndex((prev) => (prev + 1) % filteredCommands.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        if (filteredCommands[selectedIndex]) {
          handleSelect(filteredCommands[selectedIndex])
        }
      } else if (e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        if (filteredCommands[selectedIndex]) {
          handleSelect(filteredCommands[selectedIndex])
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancelSlashCommand(view, state)
      }
    }

    // Capture phase to intercept before CodeMirror
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [filteredCommands, selectedIndex, handleSelect, view, state])

  // Scroll selected item into view
  useEffect(() => {
    const selected = popupRef.current?.querySelector('[data-selected="true"]')
    selected?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (filteredCommands.length === 0) {
    return createPortal(
      <div
        ref={popupRef}
        className="fixed z-50 bg-base-01 border border-base-02 rounded-lg shadow-lg p-2 text-sm text-base-04"
        style={{ top: state.coords.top, left: state.coords.left }}
      >
        No commands found
      </div>,
      document.body
    )
  }

  return createPortal(
    <div
      ref={popupRef}
      className="fixed z-50 bg-base-01 border border-base-02 rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto min-w-[200px]"
      style={{ top: state.coords.top, left: state.coords.left }}
    >
      {filteredCommands.map((cmd, index) => (
        <button
          key={cmd.id}
          data-selected={index === selectedIndex}
          onClick={() => handleSelect(cmd)}
          onMouseEnter={() => setSelectedIndex(index)}
          className={`w-full px-3 py-2 text-left text-sm transition-colors ${
            index === selectedIndex
              ? 'bg-base-02 text-base-06'
              : 'text-base-05 hover:bg-base-02'
          }`}
        >
          <div className="font-medium">{cmd.label}</div>
          <div className="text-xs text-base-04">{cmd.description}</div>
        </button>
      ))}
    </div>,
    document.body
  )
}
