// SPDX-License-Identifier: MIT WITH Commons-Clause
// Tag state management - colors, descriptions, and metadata

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Tag metadata stored per-tag
export interface TagMetadata {
  color: string // hex color like '#e06c75'
  description?: string
}

// Base16 accent colors for random assignment
const TAG_COLORS = [
  '#e06c75', // base08 - red
  '#d19a66', // base09 - orange
  '#e5c07b', // base0A - yellow
  '#98c379', // base0B - green
  '#56b6c2', // base0C - cyan
  '#61afef', // base0D - blue
  '#c678dd', // base0E - purple
  '#be5046', // base0F - brown
]

// Generate a deterministic color from tag name (consistent across sessions)
function hashTagToColor(tagName: string): string {
  let hash = 0
  for (let i = 0; i < tagName.length; i++) {
    const char = tagName.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  const index = Math.abs(hash) % TAG_COLORS.length
  return TAG_COLORS[index]
}

interface TagState {
  // Tag metadata keyed by tag name (without #)
  tags: Record<string, TagMetadata>

  // Currently selected tag for detail view
  selectedTag: string | null

  // Actions
  getTagColor: (tagName: string) => string
  setTagColor: (tagName: string, color: string) => void
  getTagDescription: (tagName: string) => string | undefined
  setTagDescription: (tagName: string, description: string) => void
  selectTag: (tagName: string | null) => void
  ensureTag: (tagName: string) => void
}

export const useTagStore = create<TagState>()(
  persist(
    (set, get) => ({
      tags: {},
      selectedTag: null,

      getTagColor: (tagName: string) => {
        const tag = get().tags[tagName]
        if (tag?.color) {
          return tag.color
        }
        // Generate deterministic color from name
        return hashTagToColor(tagName)
      },

      setTagColor: (tagName: string, color: string) => {
        set((state) => ({
          tags: {
            ...state.tags,
            [tagName]: {
              ...state.tags[tagName],
              color,
            },
          },
        }))
      },

      getTagDescription: (tagName: string) => {
        return get().tags[tagName]?.description
      },

      setTagDescription: (tagName: string, description: string) => {
        set((state) => ({
          tags: {
            ...state.tags,
            [tagName]: {
              ...state.tags[tagName],
              color: state.tags[tagName]?.color || hashTagToColor(tagName),
              description,
            },
          },
        }))
      },

      selectTag: (tagName: string | null) => {
        set({ selectedTag: tagName })
      },

      // Ensure a tag exists in the store (called when tag is first seen)
      ensureTag: (tagName: string) => {
        const state = get()
        if (!state.tags[tagName]) {
          set({
            tags: {
              ...state.tags,
              [tagName]: {
                color: hashTagToColor(tagName),
              },
            },
          })
        }
      },
    }),
    {
      name: 'tend-tags',
    }
  )
)
