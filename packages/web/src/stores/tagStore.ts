// SPDX-License-Identifier: MIT WITH Commons-Clause
// Tag state management - colors, descriptions, and metadata

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Tag metadata stored per-tag
export interface TagMetadata {
  hue: number // 0-360 hue value
  description?: string
}

// 12 well-separated hues around the color wheel (every 30 degrees)
const HUE_PALETTE = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]

// Pick a random hue from the palette
function randomHue(): number {
  const index = Math.floor(Math.random() * HUE_PALETTE.length)
  return HUE_PALETTE[index]
}

interface TagState {
  // Tag metadata keyed by tag name (without #)
  tags: Record<string, TagMetadata>

  // Currently selected tag for detail view
  selectedTag: string | null

  // Actions
  getTagHue: (tagName: string) => number
  setTagHue: (tagName: string, hue: number) => void
  getTagDescription: (tagName: string) => string | undefined
  setTagDescription: (tagName: string, description: string) => void
  selectTag: (tagName: string | null) => void
  ensureTag: (tagName: string) => void

  // Legacy compatibility - returns CSS hsl() string for text color
  getTagColor: (tagName: string) => string
  setTagColor: (tagName: string, color: string) => void
}

/**
 * Parse a color string to extract hue
 * Supports: hsl(h, s%, l%), #rrggbb, rgb(r, g, b)
 */
function colorToHue(color: string): number {
  // HSL format
  const hslMatch = color.match(/hsl\(\s*(\d+)/)
  if (hslMatch) {
    return parseInt(hslMatch[1], 10)
  }

  // Hex format
  const hexMatch = color.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
  if (hexMatch) {
    const r = parseInt(hexMatch[1], 16) / 255
    const g = parseInt(hexMatch[2], 16) / 255
    const b = parseInt(hexMatch[3], 16) / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    let h = 0
    if (max !== min) {
      const d = max - min
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
        case g: h = ((b - r) / d + 2) / 6; break
        case b: h = ((r - g) / d + 4) / 6; break
      }
    }
    return Math.round(h * 360)
  }

  // Fallback to random hue if parsing fails
  return randomHue()
}

export const useTagStore = create<TagState>()(
  persist(
    (set, get) => ({
      tags: {},
      selectedTag: null,

      getTagHue: (tagName: string) => {
        const tag = get().tags[tagName]
        if (tag?.hue !== undefined) {
          return tag.hue
        }
        // First access - generate and persist a random hue
        const hue = randomHue()
        set((state) => ({
          tags: {
            ...state.tags,
            [tagName]: { ...state.tags[tagName], hue },
          },
        }))
        return hue
      },

      setTagHue: (tagName: string, hue: number) => {
        set((state) => ({
          tags: {
            ...state.tags,
            [tagName]: {
              ...state.tags[tagName],
              hue: hue % 360,
            },
          },
        }))
      },

      // Legacy: returns dark text color as hsl() string
      getTagColor: (tagName: string) => {
        const hue = get().getTagHue(tagName)
        return `hsl(${hue}, 70%, 35%)`
      },

      // Legacy: extracts hue from color and stores it
      setTagColor: (tagName: string, color: string) => {
        const hue = colorToHue(color)
        get().setTagHue(tagName, hue)
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
              hue: state.tags[tagName]?.hue ?? randomHue(),
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
                hue: randomHue(),
              },
            },
          })
        }
      },
    }),
    {
      name: 'tend-tags',
      // Migrate old hex color format to hue
      migrate: (persistedState: unknown, version: number) => {
        if (version < 1) {
          const state = persistedState as { tags?: Record<string, { color?: string; hue?: number; description?: string }> }
          if (state.tags) {
            const migratedTags: Record<string, TagMetadata> = {}
            for (const [name, data] of Object.entries(state.tags)) {
              migratedTags[name] = {
                hue: data.hue ?? (data.color ? colorToHue(data.color) : randomHue()),
                description: data.description,
              }
            }
            return { ...state, tags: migratedTags }
          }
        }
        return persistedState
      },
      version: 1,
    }
  )
)
