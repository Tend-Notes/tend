// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Editor V2 slash-command menu. Driven by slashMenuPlugin's trigger state: when
// the caret sits after a "/query", this renders the filtered command list at the
// caret and executes the chosen command by replacing the "/query" range with the
// command's text (the ProseMirror analogue of V1's completeSlashCommand).
//
// Keyboard selection uses a capture-phase listener so Arrow/Enter/Tab/Escape are
// handled before ProseMirror's keymap sees them — Enter picks a command instead
// of splitting the block.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { EditorView } from 'prosemirror-view'
import { TextSelection } from 'prosemirror-state'
import { useSettingsStore } from '../../../stores/settingsStore'
import { BASE_SLASH_COMMANDS, getTaskCommands, type SlashCommand, type SlashCommandContext } from '../slashCommands'
import type { SlashTrigger } from './slashMenuPlugin'

interface SlashMenuProps {
  view: EditorView
  trigger: SlashTrigger
}

export function SlashMenu({ view, trigger }: SlashMenuProps) {
  const taskStatusSet = useSettingsStore((s) => s.taskStatusSet)
  const [selectedIndex, setSelectedIndex] = useState(0)
  // Escape hides the menu until the trigger position changes (a fresh "/").
  const [dismissed, setDismissed] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const allCommands = useMemo(
    () => [...getTaskCommands(taskStatusSet), ...BASE_SLASH_COMMANDS],
    [taskStatusSet],
  )

  const filtered = useMemo(() => {
    const q = trigger.query.toLowerCase()
    if (!q) return allCommands
    return allCommands.filter(
      (cmd) => cmd.label.toLowerCase().includes(q) || cmd.id.toLowerCase().includes(q),
    )
  }, [allCommands, trigger.query])

  // Reset selection + un-dismiss whenever a new trigger begins or the query changes.
  useEffect(() => setSelectedIndex(0), [trigger.query])
  useEffect(() => setDismissed(false), [trigger.from])

  const execute = useCallback(
    (cmd: SlashCommand) => {
      const ctx: SlashCommandContext = {
        contentBefore: '',
        contentAfter: '',
        replaceContent: () => {},
        insertContent: (text: string) => {
          const tr = view.state.tr.insertText(text, trigger.from, trigger.to)
          // Place the caret after the inserted text.
          const pos = trigger.from + text.length
          tr.setSelection(TextSelection.create(tr.doc, pos)).scrollIntoView()
          view.dispatch(tr)
        },
      }
      cmd.action(ctx)
      view.focus()
    },
    [view, trigger.from, trigger.to],
  )

  // Capture-phase key handling so it beats ProseMirror's keymap.
  useEffect(() => {
    if (dismissed) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (filtered.length === 0) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDismissed(true) }
        return
      }
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault(); e.stopPropagation()
          setSelectedIndex((p) => (p + 1) % filtered.length)
          break
        case 'ArrowUp':
          e.preventDefault(); e.stopPropagation()
          setSelectedIndex((p) => (p - 1 + filtered.length) % filtered.length)
          break
        case 'Enter':
        case 'Tab':
          e.preventDefault(); e.stopPropagation()
          execute(filtered[selectedIndex])
          break
        case 'Escape':
          e.preventDefault(); e.stopPropagation()
          setDismissed(true)
          break
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [dismissed, filtered, selectedIndex, execute])

  // Keep the highlighted row in view.
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-selected="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (dismissed) return null

  // Anchor to the caret: below and left-aligned to the '/'.
  const coords = view.coordsAtPos(trigger.from)
  const style = { top: coords.bottom, left: coords.left } as const

  if (filtered.length === 0) {
    return createPortal(
      <div
        className="slash-menu fixed z-50 bg-base-01 border border-base-02 rounded-lg shadow-lg p-2 text-sm text-base-04"
        style={style}
      >
        No commands found
      </div>,
      document.body,
    )
  }

  return createPortal(
    <div
      ref={listRef}
      className="slash-menu fixed z-50 bg-base-01 border border-base-02 rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto min-w-[200px]"
      style={style}
    >
      {filtered.map((cmd, index) => (
        <button
          key={cmd.id}
          data-selected={index === selectedIndex}
          onMouseDown={(e) => { e.preventDefault(); execute(cmd) }}
          onMouseEnter={() => setSelectedIndex(index)}
          className={`w-full px-3 py-2 text-left text-sm transition-colors ${
            index === selectedIndex ? 'bg-base-02 text-base-06' : 'text-base-05 hover:bg-base-02'
          }`}
        >
          <div className="font-medium">{cmd.label}</div>
          <div className="text-xs text-base-04">{cmd.description}</div>
        </button>
      ))}
    </div>,
    document.body,
  )
}
