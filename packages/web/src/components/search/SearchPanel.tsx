// SPDX-License-Identifier: MIT WITH Commons-Clause
import { useEffect, useState, useCallback } from 'react'
import { useUIStore } from '../../stores/uiStore'
import { usePageStore } from '../../stores/pageStore'
import * as api from '../../lib/api'
import type { SearchResult } from '../../types'

export function SearchPanel() {
  const { searchOpen, closeSearch } = useUIStore()
  const { navigateToPage, navigateToJournal } = usePageStore()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)

  // Search when query changes (debounced)
  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }

    const timeout = setTimeout(async () => {
      setIsLoading(true)
      try {
        const searchResults = await api.search.query(query, 20)
        setResults(searchResults)
        setSelectedIndex(0)
      } catch (e) {
        console.error('Search failed:', e)
        setResults([])
      } finally {
        setIsLoading(false)
      }
    }, 150)

    return () => clearTimeout(timeout)
  }, [query])

  // Reset when opening
  useEffect(() => {
    if (searchOpen) {
      setQuery('')
      setResults([])
      setSelectedIndex(0)
    }
  }, [searchOpen])

  const handleSelect = useCallback((result: SearchResult) => {
    closeSearch()
    if (result.isJournal) {
      // Extract date from page name (format: YYYY-MM-DD)
      const date = result.pageName
      navigateToJournal(date)
    } else {
      navigateToPage(result.pageName)
    }
  }, [closeSearch, navigateToPage, navigateToJournal])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeSearch()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      handleSelect(results[selectedIndex])
    }
  }, [closeSearch, results, selectedIndex, handleSelect])

  if (!searchOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="overlay-backdrop fixed inset-0 bg-black/50 animate-fade-in"
        onClick={closeSearch}
      />

      {/* Dialog */}
      <div className="overlay-content relative w-full max-w-2xl bg-base-01 rounded-lg shadow-2xl border border-base-02 overflow-hidden">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search pages and blocks..."
          autoFocus
          className="w-full px-4 py-3 bg-transparent border-b border-base-02 text-base-05 placeholder:text-base-04 focus:outline-none"
        />

        <div className="max-h-96 overflow-y-auto">
          {isLoading && (
            <div className="py-4 text-center text-sm text-base-04">
              Searching...
            </div>
          )}

          {!isLoading && query && results.length === 0 && (
            <div className="py-6 text-center text-sm text-base-04">
              No results found
            </div>
          )}

          {!isLoading && results.map((result, index) => (
            <button
              key={`${result.pageName}-${result.uuid}`}
              onClick={() => handleSelect(result)}
              className={`w-full px-4 py-3 text-left transition-colors ${
                index === selectedIndex
                  ? 'bg-base-02'
                  : 'hover:bg-base-02/50'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium text-base-05">
                  {result.pageTitle}
                </span>
                {result.isJournal && (
                  <span className="text-xs text-base-04 px-1.5 py-0.5 bg-base-02 rounded">
                    Journal
                  </span>
                )}
              </div>
              <div className="text-sm text-base-04 truncate">
                {result.content}
              </div>
            </button>
          ))}

          {!query && (
            <div className="py-6 text-center text-sm text-base-04">
              Type to search pages and blocks
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
