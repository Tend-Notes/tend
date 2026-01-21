// SPDX-License-Identifier: MIT WITH Commons-Clause
// Slash command popup - triggered by '/' at start of block or after whitespace

import { useEffect, useState, useCallback, useRef } from 'react'

export interface SlashCommand {
  id: string
  label: string
  description: string
  icon?: string
  action: (context: SlashCommandContext) => void
}

export interface SlashCommandContext {
  // The block content before the slash command
  contentBefore: string
  // The block content after the slash command query
  contentAfter: string
  // Function to replace the block content
  replaceContent: (newContent: string) => void
  // Function to insert content at the slash command position
  insertContent: (content: string) => void
}

interface SlashCommandPopupProps {
  query: string
  position: { top: number; left: number }
  onSelect: (command: SlashCommand) => void
  onClose: () => void
}

// Built-in slash commands
const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: 'todo',
    label: 'TODO',
    description: 'Create a TODO task',
    action: (ctx) => ctx.insertContent('TODO '),
  },
  {
    id: 'doing',
    label: 'DOING',
    description: 'Create an in-progress task',
    action: (ctx) => ctx.insertContent('DOING '),
  },
  {
    id: 'done',
    label: 'DONE',
    description: 'Create a completed task',
    action: (ctx) => ctx.insertContent('DONE '),
  },
  {
    id: 'now',
    label: 'NOW',
    description: 'Mark as current focus',
    action: (ctx) => ctx.insertContent('NOW '),
  },
  {
    id: 'later',
    label: 'LATER',
    description: 'Mark for later',
    action: (ctx) => ctx.insertContent('LATER '),
  },
  {
    id: 'h1',
    label: 'Heading 1',
    description: 'Large section heading',
    action: (ctx) => ctx.insertContent('# '),
  },
  {
    id: 'h2',
    label: 'Heading 2',
    description: 'Medium section heading',
    action: (ctx) => ctx.insertContent('## '),
  },
  {
    id: 'h3',
    label: 'Heading 3',
    description: 'Small section heading',
    action: (ctx) => ctx.insertContent('### '),
  },
  {
    id: 'code',
    label: 'Code Block',
    description: 'Insert a code block',
    action: (ctx) => ctx.insertContent('```\n'),
  },
  {
    id: 'quote',
    label: 'Quote',
    description: 'Insert a blockquote',
    action: (ctx) => ctx.insertContent('> '),
  },
  {
    id: 'hr',
    label: 'Horizontal Rule',
    description: 'Insert a divider line',
    action: (ctx) => ctx.insertContent('---'),
  },
  {
    id: 'date',
    label: 'Today\'s Date',
    description: 'Insert current date',
    action: (ctx) => {
      const today = new Date()
      const formatted = today.toISOString().split('T')[0]
      ctx.insertContent(`[[journal/${formatted}]]`)
    },
  },
  {
    id: 'time',
    label: 'Current Time',
    description: 'Insert current time',
    action: (ctx) => {
      const now = new Date()
      const formatted = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      ctx.insertContent(formatted)
    },
  },
]

export function SlashCommandPopup({ query, position, onSelect, onClose }: SlashCommandPopupProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // Filter commands based on query
  const filteredCommands = SLASH_COMMANDS.filter((cmd) =>
    cmd.label.toLowerCase().includes(query.toLowerCase()) ||
    cmd.id.toLowerCase().includes(query.toLowerCase())
  )

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current && filteredCommands.length > 0) {
      const selectedEl = listRef.current.children[selectedIndex] as HTMLElement
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedIndex, filteredCommands.length])

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (filteredCommands.length === 0) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex((prev) => (prev + 1) % filteredCommands.length)
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length)
        break
      case 'Enter':
        e.preventDefault()
        e.stopPropagation()
        onSelect(filteredCommands[selectedIndex])
        break
      case 'Tab':
        e.preventDefault()
        onSelect(filteredCommands[selectedIndex])
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }, [filteredCommands, selectedIndex, onSelect, onClose])

  // Attach keyboard handler
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [handleKeyDown])

  if (filteredCommands.length === 0) {
    return (
      <div
        className="fixed z-50 bg-base-01 border border-base-02 rounded-lg shadow-lg p-2 text-sm text-base-04"
        style={{ top: position.top, left: position.left }}
      >
        No commands found
      </div>
    )
  }

  return (
    <div
      ref={listRef}
      className="fixed z-50 bg-base-01 border border-base-02 rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto min-w-[200px]"
      style={{ top: position.top, left: position.left }}
    >
      {filteredCommands.map((cmd, index) => (
        <button
          key={cmd.id}
          onClick={() => onSelect(cmd)}
          onMouseEnter={() => setSelectedIndex(index)}
          className={`w-full px-3 py-2 text-left text-sm transition-colors flex items-center gap-2 ${
            index === selectedIndex
              ? 'bg-base-02 text-base-06'
              : 'text-base-05 hover:bg-base-02'
          }`}
        >
          <div className="flex-1">
            <div className="font-medium">{cmd.label}</div>
            <div className="text-xs text-base-04">{cmd.description}</div>
          </div>
        </button>
      ))}
    </div>
  )
}

export { SLASH_COMMANDS }
