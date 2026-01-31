// SPDX-License-Identifier: MIT WITH Commons-Clause
// Sidebar tags panel - shows all tags with option to view/edit tag details

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useTagStore } from '../../stores/tagStore'
import { usePageStore } from '../../stores/pageStore'
import { tags as tagsApi, type TagInfo } from '../../lib/api'

interface SidebarTagsProps {
  onBack: () => void
}

type SortMode = 'alpha' | 'count'

export function SidebarTags({ onBack }: SidebarTagsProps) {
  const { getTagHue, setTagHue } = useTagStore()
  const { currentPage, navigateToPage } = usePageStore()

  // Tag currently being hue-edited (inline)
  const [editingHueTag, setEditingHueTag] = useState<string | null>(null)

  // Sort mode and direction
  const [sortMode, setSortMode] = useState<SortMode>('alpha')
  const [sortAscending, setSortAscending] = useState(true)

  // All tags from the backend API
  const [allTags, setAllTags] = useState<TagInfo[]>([])
  const [hasFetched, setHasFetched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sorted tags
  const sortedTags = useMemo(() => {
    return [...allTags].sort((a, b) => {
      let cmp: number
      if (sortMode === 'alpha') {
        cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      } else {
        cmp = b.count - a.count // Default: most used first
      }
      return sortAscending ? cmp : -cmp
    })
  }, [allTags, sortMode, sortAscending])

  // Track refresh trigger
  const [refreshCounter, setRefreshCounter] = useState(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isInitialMount = useRef(true)

  // Debounced refresh when page content changes
  useEffect(() => {
    // Skip the initial mount - we already fetch on mount via refreshCounter
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }

    // Clear any pending debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    // Debounce the refresh to avoid too many API calls while typing
    debounceRef.current = setTimeout(() => {
      setRefreshCounter(c => c + 1)
    }, 1000) // 1 second debounce

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [currentPage?.blocks])

  // Fetch all tags from backend
  useEffect(() => {
    let cancelled = false

    async function fetchTags() {
      try {
        setError(null)
        const tagList = await tagsApi.list()
        if (!cancelled) {
          setAllTags(tagList)
          setHasFetched(true)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load tags')
          setHasFetched(true)
        }
      }
    }

    fetchTags()

    return () => {
      cancelled = true
    }
  }, [refreshCounter])

  // Handle tag name click - navigate to tag page
  const handleTagClick = useCallback((tagName: string) => {
    navigateToPage(`tags/${tagName}`)
  }, [navigateToPage])

  // Handle color pill click - toggle hue editor
  const handleHuePillClick = useCallback((tagName: string, e: React.MouseEvent) => {
    e.stopPropagation() // Don't trigger tag navigation
    setEditingHueTag(editingHueTag === tagName ? null : tagName)
  }, [editingHueTag])

  // Handle hue change
  const handleHueChange = useCallback((tagName: string, hue: number) => {
    setTagHue(tagName, hue)
  }, [setTagHue])

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
        <span className="text-sm font-medium text-base-05">Tags</span>
        <div className="w-4" /> {/* Spacer for alignment */}
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-base-02">
        <button
          onClick={() => setSortMode('alpha')}
          className={`px-2 py-1 text-xs rounded transition-colors ${
            sortMode === 'alpha'
              ? 'bg-base-02 text-base-05'
              : 'text-base-04 hover:text-base-05'
          }`}
        >
          A-Z
        </button>
        <button
          onClick={() => setSortMode('count')}
          className={`px-2 py-1 text-xs rounded transition-colors ${
            sortMode === 'count'
              ? 'bg-base-02 text-base-05'
              : 'text-base-04 hover:text-base-05'
          }`}
        >
          Most used
        </button>
        <button
          onClick={() => setSortAscending(!sortAscending)}
          className="ml-auto p-1 text-base-04 hover:text-base-05 transition-colors"
          title={sortAscending ? 'Sort descending' : 'Sort ascending'}
        >
          <svg
            className={`w-4 h-4 transition-transform ${sortAscending ? '' : 'rotate-180'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
          </svg>
        </button>
      </div>

      {/* Tag list */}
      <div className="flex-1 overflow-y-auto p-3">
        {!hasFetched ? (
          null
        ) : error ? (
          <div className="text-center text-base-08 text-sm py-8">
            {error}
          </div>
        ) : sortedTags.length === 0 ? (
          <div className="text-center text-base-04 text-sm py-8">
            No tags found. Use #tagname in your notes to create tags.
          </div>
        ) : (
          <ul className="space-y-1">
            {sortedTags.map((tag) => {
              const hue = getTagHue(tag.name)
              const isEditingHue = editingHueTag === tag.name

              return (
                <li key={tag.name} className="relative">
                  <div className="flex items-center gap-1">
                    {/* Color pill - click to edit hue */}
                    <button
                      onClick={(e) => handleHuePillClick(tag.name, e)}
                      className={`p-1.5 rounded-lg transition-colors flex-shrink-0 ${
                        isEditingHue ? 'bg-base-02' : 'hover:bg-base-01'
                      }`}
                      title="Edit tag color"
                    >
                      <span
                        className="block w-3 h-3 rounded-full"
                        style={{ backgroundColor: `hsl(${hue}, 60%, 50%)` }}
                      />
                    </button>

                    {/* Tag name - click to navigate */}
                    <button
                      onClick={() => handleTagClick(tag.name)}
                      className="flex-1 flex items-center justify-between px-2 py-1.5 rounded-lg transition-colors hover:bg-base-01"
                    >
                      <span className="text-sm text-base-05">#{tag.name}</span>
                      {tag.count > 0 && (
                        <span className="text-xs text-base-04">{tag.count}</span>
                      )}
                    </button>
                  </div>

                  {/* Inline hue slider (shown when editing) */}
                  {isEditingHue && (
                    <div className="mt-1 ml-1 p-2 bg-base-01 rounded-lg border border-base-02 flex items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={359}
                        value={hue}
                        onChange={(e) => handleHueChange(tag.name, parseInt(e.target.value, 10))}
                        className="flex-1 h-2 rounded-lg appearance-none cursor-pointer"
                        style={{
                          background: 'linear-gradient(to right, hsl(0,70%,50%), hsl(60,70%,50%), hsl(120,70%,50%), hsl(180,70%,50%), hsl(240,70%,50%), hsl(300,70%,50%), hsl(360,70%,50%))',
                        }}
                      />
                      <span
                        className="w-6 h-6 rounded-full flex-shrink-0"
                        style={{ backgroundColor: `hsl(${hue}, 60%, 50%)` }}
                      />
                      <button
                        onClick={() => setEditingHueTag(null)}
                        className="p-1 text-base-04 hover:text-base-05 transition-colors"
                        title="Close"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
