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
  const { selectedTag, selectTag, getTagColor, setTagColor, getTagDescription, setTagDescription } = useTagStore()
  const currentPage = usePageStore((state) => state.currentPage)

  // Local state for editing description
  const [editingDescription, setEditingDescription] = useState(false)
  const [descriptionValue, setDescriptionValue] = useState('')

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

  // Handle tag selection
  const handleTagClick = useCallback((tagName: string) => {
    if (selectedTag === tagName) {
      selectTag(null)
    } else {
      selectTag(tagName)
      setDescriptionValue(getTagDescription(tagName) || '')
      setEditingDescription(false)
    }
  }, [selectedTag, selectTag, getTagDescription])

  // Handle description save
  const handleDescriptionSave = useCallback(() => {
    if (selectedTag) {
      setTagDescription(selectedTag, descriptionValue)
      setEditingDescription(false)
    }
  }, [selectedTag, descriptionValue, setTagDescription])

  // Handle color change
  const handleColorChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (selectedTag) {
      setTagColor(selectedTag, e.target.value)
    }
  }, [selectedTag, setTagColor])

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
              const color = getTagColor(tag.name)
              const isSelected = selectedTag === tag.name

              return (
                <li key={tag.name}>
                  <button
                    onClick={() => handleTagClick(tag.name)}
                    className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg transition-colors ${
                      isSelected
                        ? 'bg-base-02'
                        : 'hover:bg-base-01'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-sm text-base-05">#{tag.name}</span>
                    </div>
                    {tag.count > 0 && (
                      <span className="text-xs text-base-04">{tag.count}</span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Tag detail panel (when a tag is selected) */}
      {selectedTag && (
        <div className="border-t border-base-02 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className="w-4 h-4 rounded-full flex-shrink-0"
                style={{ backgroundColor: getTagColor(selectedTag) }}
              />
              <span className="text-sm font-medium text-base-06">#{selectedTag}</span>
            </div>
            <button
              onClick={() => selectTag(null)}
              className="p-1 text-base-04 hover:text-base-05 transition-colors"
              title="Close"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Color picker */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-base-04">Color:</label>
            <input
              type="color"
              value={getTagColor(selectedTag)}
              onChange={handleColorChange}
              className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
              style={{ padding: 0 }}
            />
            <span className="text-xs text-base-04 font-mono">{getTagColor(selectedTag)}</span>
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs text-base-04">Description:</label>
            {editingDescription ? (
              <div className="space-y-2">
                <textarea
                  value={descriptionValue}
                  onChange={(e) => setDescriptionValue(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm bg-base-01 border border-base-02 rounded-lg text-base-05 resize-none focus:outline-none focus:border-base-0D"
                  rows={3}
                  placeholder="What is this tag about?"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleDescriptionSave}
                    className="px-3 py-1 text-xs bg-base-0D text-base-00 rounded hover:opacity-90 transition-opacity"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setEditingDescription(false)
                      setDescriptionValue(getTagDescription(selectedTag) || '')
                    }}
                    className="px-3 py-1 text-xs text-base-04 hover:text-base-05 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => {
                  setDescriptionValue(getTagDescription(selectedTag) || '')
                  setEditingDescription(true)
                }}
                className="w-full text-left px-2 py-1.5 text-sm bg-base-01 border border-base-02 rounded-lg text-base-05 hover:border-base-03 transition-colors min-h-[2.5rem]"
              >
                {getTagDescription(selectedTag) || (
                  <span className="text-base-04 italic">Click to add description...</span>
                )}
              </button>
            )}
          </div>

          {/* Usage count */}
          <div className="space-y-1">
            <label className="text-xs text-base-04">
              Used in: {allTags.find(t => t.name === selectedTag)?.count || 0} block(s) across all pages
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
