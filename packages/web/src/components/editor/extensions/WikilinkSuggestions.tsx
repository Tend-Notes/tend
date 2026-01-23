// SPDX-License-Identifier: MIT WITH Commons-Clause
// Wikilink suggestions popup component
//
// Renders as a floating popup when user types [[
// Shows filtered list of pages/sheets and allows selection

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { EditorView } from '@codemirror/view'
import * as api from '../../../lib/api'
import { useSettingsStore } from '../../../stores/settingsStore'
import type { WikilinkState } from './wikilink'
import { completeWikilink, cancelWikilink } from './wikilink'

interface WikilinkSuggestionsProps {
  view: EditorView
  state: WikilinkState
}

interface SuggestionItem {
  // Display name
  title: string
  // The value to insert (may include path prefix for content types)
  value: string
  // Subtitle/description
  subtitle?: string
  // Whether this creates a new page
  isCreate?: boolean
}

export function WikilinkSuggestions({ view, state }: WikilinkSuggestionsProps) {
  const [items, setItems] = useState<SuggestionItem[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const popupRef = useRef<HTMLDivElement>(null)
  const contentTypes = useSettingsStore((s) => s.contentTypes)

  // Load all available pages/sheets
  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        // Load pages and journals
        const [pages, journals] = await Promise.all([
          api.pages.list(),
          api.journals.list(),
        ])

        // Load sheets for custom content types
        const customTypes = contentTypes.filter(ct => ct.id !== 'page' && ct.id !== 'journal')
        const sheetResults = await Promise.all(
          customTypes.map(async (ct) => {
            try {
              const sheets = await api.sheets.list(ct.id)
              return { contentType: ct, sheets }
            } catch {
              return { contentType: ct, sheets: [] }
            }
          })
        )

        if (cancelled) return

        // Build suggestion items
        const suggestions: SuggestionItem[] = []

        // Pages (no prefix needed - they're the default)
        for (const page of pages) {
          suggestions.push({
            title: page.title,
            value: page.name,
            subtitle: page.name !== page.title ? page.name : undefined,
          })
        }

        // Journals
        for (const journal of journals) {
          suggestions.push({
            title: journal.title,
            value: `journals/${journal.journalDate || journal.name}`,
            subtitle: 'Journal',
          })
        }

        // Custom content type sheets
        for (const { contentType, sheets } of sheetResults) {
          for (const sheet of sheets) {
            suggestions.push({
              title: sheet.title,
              value: `${contentType.directory}/${sheet.name}`,
              subtitle: contentType.name,
            })
          }
        }

        setItems(suggestions)
        setLoading(false)
      } catch (err) {
        console.error('Failed to load suggestions:', err)
        setItems([])
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [contentTypes])

  // Filter items by query
  const filteredItems = useMemo(() => {
    const query = state.query.toLowerCase().trim()
    if (!query) return items.slice(0, 10) // Show first 10 when no query

    return items
      .filter(item =>
        item.title.toLowerCase().includes(query) ||
        item.value.toLowerCase().includes(query)
      )
      .slice(0, 10) // Limit to 10 results
  }, [items, state.query])

  // Add "Create" option if query doesn't match exactly
  const showCreateOption = state.query.length > 0 &&
    !filteredItems.some(item =>
      item.value.toLowerCase() === state.query.toLowerCase() ||
      item.title.toLowerCase() === state.query.toLowerCase()
    )

  const allItems = useMemo(() => {
    if (showCreateOption) {
      return [
        ...filteredItems,
        {
          title: `Create "${state.query}"`,
          value: state.query,
          subtitle: 'New page',
          isCreate: true,
        },
      ]
    }
    return filteredItems
  }, [filteredItems, showCreateOption, state.query])

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [state.query])

  // Handle selection
  const handleSelect = useCallback((item: SuggestionItem) => {
    completeWikilink(view, state, item.value)
  }, [view, state])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        setSelectedIndex(prev => (prev + 1) % allItems.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setSelectedIndex(prev => (prev - 1 + allItems.length) % allItems.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        if (allItems[selectedIndex]) {
          handleSelect(allItems[selectedIndex])
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancelWikilink(view)
      } else if (e.key === 'Tab') {
        // Tab also selects
        e.preventDefault()
        e.stopPropagation()
        if (allItems[selectedIndex]) {
          handleSelect(allItems[selectedIndex])
        }
      }
    }

    // Capture phase to intercept before CodeMirror
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [allItems, selectedIndex, handleSelect, view])

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        cancelWikilink(view)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [view])

  // Scroll selected item into view
  useEffect(() => {
    const selected = popupRef.current?.querySelector('[data-selected="true"]')
    selected?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (loading) {
    return createPortal(
      <div
        ref={popupRef}
        className="fixed z-50 bg-base-01 border border-base-02 rounded-lg shadow-lg p-2 text-sm text-base-04"
        style={{ top: state.coords.top, left: state.coords.left }}
      >
        Loading...
      </div>,
      document.body
    )
  }

  if (allItems.length === 0) {
    return createPortal(
      <div
        ref={popupRef}
        className="fixed z-50 bg-base-01 border border-base-02 rounded-lg shadow-lg p-2 text-sm text-base-04"
        style={{ top: state.coords.top, left: state.coords.left }}
      >
        No matches
      </div>,
      document.body
    )
  }

  return createPortal(
    <div
      ref={popupRef}
      className="fixed z-50 bg-base-01 border border-base-02 rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto min-w-48"
      style={{ top: state.coords.top, left: state.coords.left }}
    >
      {allItems.map((item, index) => (
        <button
          key={`${item.value}-${index}`}
          data-selected={index === selectedIndex}
          onClick={() => handleSelect(item)}
          className={`w-full px-3 py-2 text-left text-sm transition-colors ${
            index === selectedIndex
              ? 'bg-base-02 text-base-06'
              : 'text-base-05 hover:bg-base-02'
          } ${item.isCreate ? 'border-t border-base-02' : ''}`}
        >
          <div className="font-medium">{item.title}</div>
          {item.subtitle && (
            <div className="text-xs text-base-04">{item.subtitle}</div>
          )}
        </button>
      ))}
    </div>,
    document.body
  )
}
