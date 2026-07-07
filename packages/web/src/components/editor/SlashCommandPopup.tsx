// SPDX-License-Identifier: MIT WITH Commons-Clause
// Slash command popup - triggered by '/' at start of block or after whitespace

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { BASE_SLASH_COMMANDS, getTaskCommands, type SlashCommand } from './slashCommands'

export type { SlashCommand, SlashCommandContext } from './slashCommands'

interface SlashCommandPopupProps {
  query: string
  position: { top: number; left: number }
  onSelect: (command: SlashCommand) => void
  onClose: () => void
}

export function SlashCommandPopup({ query, position, onSelect, onClose }: SlashCommandPopupProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const taskStatusSet = useSettingsStore((state) => state.taskStatusSet)
  const contentTypes = useSettingsStore((state) => state.contentTypes)

  // Custom content types (excluding built-in page and journal)
  const customContentTypes = contentTypes.filter(ct => ct.id !== 'page' && ct.id !== 'journal')

  // Build commands list: task statuses, then content types, then other commands
  const allCommands = useMemo(() => {
    const taskCommands = getTaskCommands(taskStatusSet)

    // Generate content type commands
    const contentTypeCommands: SlashCommand[] = customContentTypes.map((ct) => ({
      id: `new-${ct.id}`,
      label: `New ${ct.name}`,
      description: `Create a new ${ct.name.toLowerCase()}`,
      contentType: ct,
      action: () => {}, // Handled specially in Block.tsx
    }))

    return [...taskCommands, ...contentTypeCommands, ...BASE_SLASH_COMMANDS]
  }, [taskStatusSet, customContentTypes])

  // Filter commands based on query
  const filteredCommands = allCommands.filter((cmd) =>
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

export { BASE_SLASH_COMMANDS, getTaskCommands }
