// SPDX-License-Identifier: MIT WITH Commons-Clause
// Wiki-link autocomplete popup for contenteditable blocks

import { useEffect, useState, useCallback, useRef } from 'react'
import * as api from '../../lib/api'
import type { PageMeta } from '../../types'

interface WikiLinkPopupProps {
  query: string
  position: { top: number; left: number }
  onSelect: (pageName: string) => void
  onClose: () => void
}

export function WikiLinkPopup({ query, position, onSelect, onClose }: WikiLinkPopupProps) {
  const [pages, setPages] = useState<PageMeta[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const popupRef = useRef<HTMLDivElement>(null)

  // Load pages on mount
  useEffect(() => {
    api.pages.list().then((allPages) => {
      setPages(allPages)
      setLoading(false)
    })
  }, [])

  // Filter pages by query
  const filteredPages = pages.filter((page) =>
    page.title.toLowerCase().includes(query.toLowerCase()) ||
    page.name.toLowerCase().includes(query.toLowerCase())
  )

  // Add "Create page" option if query doesn't match exactly
  const showCreateOption = query.length > 0 &&
    !filteredPages.some(p => p.name.toLowerCase() === query.toLowerCase())

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const totalItems = filteredPages.length + (showCreateOption ? 1 : 0)

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        setSelectedIndex((prev) => (prev + 1) % totalItems)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        if (showCreateOption && selectedIndex === filteredPages.length) {
          onSelect(query)
        } else if (filteredPages[selectedIndex]) {
          onSelect(filteredPages[selectedIndex].name)
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    },
    [filteredPages, selectedIndex, showCreateOption, query, onSelect, onClose]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [handleKeyDown])

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  if (loading) {
    return (
      <div
        ref={popupRef}
        className="fixed z-50 bg-base-01 border border-base-02 rounded-lg shadow-lg p-2 text-sm text-base-04"
        style={{ top: position.top, left: position.left }}
      >
        Loading...
      </div>
    )
  }

  const totalItems = filteredPages.length + (showCreateOption ? 1 : 0)

  if (totalItems === 0) {
    return (
      <div
        ref={popupRef}
        className="fixed z-50 bg-base-01 border border-base-02 rounded-lg shadow-lg p-2 text-sm text-base-04"
        style={{ top: position.top, left: position.left }}
      >
        No pages found
      </div>
    )
  }

  return (
    <div
      ref={popupRef}
      className="fixed z-50 bg-base-01 border border-base-02 rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto min-w-48"
      style={{ top: position.top, left: position.left }}
    >
      {filteredPages.map((page, index) => (
        <button
          key={page.name}
          onClick={() => onSelect(page.name)}
          className={`w-full px-3 py-2 text-left text-sm transition-colors ${
            index === selectedIndex
              ? 'bg-base-02 text-base-06'
              : 'text-base-05 hover:bg-base-02'
          }`}
        >
          <div className="font-medium">{page.title}</div>
          {page.title !== page.name && (
            <div className="text-xs text-base-04">{page.name}</div>
          )}
        </button>
      ))}
      {showCreateOption && (
        <button
          onClick={() => onSelect(query)}
          className={`w-full px-3 py-2 text-left text-sm transition-colors border-t border-base-02 ${
            selectedIndex === filteredPages.length
              ? 'bg-base-02 text-base-06'
              : 'text-base-05 hover:bg-base-02'
          }`}
        >
          <div className="font-medium">Create "{query}"</div>
          <div className="text-xs text-base-04">New page</div>
        </button>
      )}
    </div>
  )
}
