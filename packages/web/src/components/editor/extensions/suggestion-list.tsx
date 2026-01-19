// SPDX-License-Identifier: MIT WITH Commons-Clause
// Suggestion popup component for wiki-links and block references

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  useCallback,
} from 'react'

export interface SuggestionItem {
  id: string
  label: string
  description?: string
}

export interface SuggestionListProps {
  items: SuggestionItem[]
  command: (item: SuggestionItem) => void
}

export interface SuggestionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

export const SuggestionList = forwardRef<SuggestionListRef, SuggestionListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)

    const selectItem = useCallback(
      (index: number) => {
        const item = items[index]
        if (item) {
          command(item)
        }
      },
      [items, command]
    )

    const upHandler = useCallback(() => {
      setSelectedIndex((prev) => (prev + items.length - 1) % items.length)
    }, [items.length])

    const downHandler = useCallback(() => {
      setSelectedIndex((prev) => (prev + 1) % items.length)
    }, [items.length])

    const enterHandler = useCallback(() => {
      selectItem(selectedIndex)
    }, [selectItem, selectedIndex])

    useEffect(() => {
      setSelectedIndex(0)
    }, [items])

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        // Only handle keys if we have items to navigate
        if (items.length === 0) {
          return false
        }

        if (event.key === 'ArrowUp') {
          upHandler()
          return true
        }

        if (event.key === 'ArrowDown') {
          downHandler()
          return true
        }

        if (event.key === 'Enter') {
          enterHandler()
          return true
        }

        return false
      },
    }))

    if (items.length === 0) {
      return (
        <div className="bg-base-01 border border-base-02 rounded-lg shadow-lg p-2 text-sm text-base-04">
          No results
        </div>
      )
    }

    return (
      <div className="bg-base-01 border border-base-02 rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto">
        {items.map((item, index) => (
          <button
            key={item.id}
            onClick={() => selectItem(index)}
            className={`w-full px-3 py-2 text-left text-sm transition-colors ${
              index === selectedIndex
                ? 'bg-base-02 text-base-06'
                : 'text-base-05 hover:bg-base-02'
            }`}
          >
            <div className="font-medium">{item.label}</div>
            {item.description && (
              <div className="text-xs text-base-04 truncate">{item.description}</div>
            )}
          </button>
        ))}
      </div>
    )
  }
)

SuggestionList.displayName = 'SuggestionList'
