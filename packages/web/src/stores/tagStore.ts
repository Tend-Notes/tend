// SPDX-License-Identifier: MIT WITH Commons-Clause
// Tag state management - colors, descriptions, and metadata

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Tag color values for HSL styling
export interface TagColors {
  hue: number        // 0-359 hue
  sat: number        // 50-85 saturation (vibrant)
  textL: number      // 22-38 text lightness (dark)
  bgL: number        // 82-94 background lightness (light)
}

// Tag metadata stored per-tag
export interface TagMetadata extends TagColors {
  description?: string
}

// Random value in range [min, max]
function randomInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// Generate random tag color values
function randomTagColors(): TagColors {
  const colors = {
    hue: randomInRange(0, 359),
    sat: randomInRange(50, 85),
    textL: randomInRange(22, 38),
    bgL: randomInRange(82, 94),
  }
  return colors
}

// Colors generated for a tag that isn't persisted yet. getTagColors is called
// during render (from contentRenderer/Sidebar), so it must not set()/write
// localStorage synchronously — it stashes the color here, returns it stably,
// and persists on a microtask after render.
const pendingTagColors = new Map<string, TagColors>()

interface TagState {
  // Tag metadata keyed by tag name (without #)
  tags: Record<string, TagMetadata>

  // Currently selected tag for detail view
  selectedTag: string | null

  // Actions
  getTagColors: (tagName: string) => TagColors
  setTagColors: (tagName: string, colors: Partial<TagColors>) => void
  getTagDescription: (tagName: string) => string | undefined
  setTagDescription: (tagName: string, description: string) => void
  selectTag: (tagName: string | null) => void
  ensureTag: (tagName: string) => void

  // Legacy compatibility
  getTagHue: (tagName: string) => number
  setTagHue: (tagName: string, hue: number) => void

  // Reset (for user switching)
  reset: () => void
}

export const useTagStore = create<TagState>()(
  persist(
    (set, get) => ({
      tags: {},
      selectedTag: null,

      getTagColors: (tagName: string) => {
        const tag = get().tags[tagName]
        if (tag?.hue !== undefined && tag?.sat !== undefined && tag?.textL !== undefined && tag?.bgL !== undefined) {
          return tag as TagColors
        }
        // First access: reuse a color already generated this session for
        // stability, else generate one. Persist AFTER render (microtask) so we
        // don't call set()/write localStorage during another component's render.
        let colors = pendingTagColors.get(tagName)
        if (!colors) {
          colors = randomTagColors()
          pendingTagColors.set(tagName, colors)
          queueMicrotask(() => {
            get().setTagColors(tagName, pendingTagColors.get(tagName)!)
            pendingTagColors.delete(tagName)
          })
        }
        return colors
      },

      setTagColors: (tagName: string, colors: Partial<TagColors>) => {
        set((state) => ({
          tags: {
            ...state.tags,
            [tagName]: { ...state.tags[tagName], ...colors },
          },
        }))
      },

      // Legacy: just returns hue
      getTagHue: (tagName: string) => {
        return get().getTagColors(tagName).hue
      },

      setTagHue: (tagName: string, hue: number) => {
        get().setTagColors(tagName, { hue })
      },

      getTagDescription: (tagName: string) => {
        return get().tags[tagName]?.description
      },

      setTagDescription: (tagName: string, description: string) => {
        const colors = get().getTagColors(tagName) // Ensure colors exist
        set((state) => ({
          tags: {
            ...state.tags,
            [tagName]: { ...state.tags[tagName], ...colors, description },
          },
        }))
      },

      selectTag: (tagName: string | null) => {
        set({ selectedTag: tagName })
      },

      ensureTag: (tagName: string) => {
        get().getTagColors(tagName) // This will create if not exists
      },

      // Reset all tag data (used when switching users)
      reset: () => {
        set({ tags: {}, selectedTag: null })
      },
    }),
    {
      name: 'tend-tags',
      // Migrate old formats to new color structure
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as { tags?: Record<string, Partial<TagMetadata>> }

        if (version < 2 && state.tags) {
          // v0/v1 had only hue (or old hex color), upgrade to full color set
          const migratedTags: Record<string, TagMetadata> = {}
          for (const [name, data] of Object.entries(state.tags)) {
            const colors = randomTagColors()
            migratedTags[name] = {
              hue: data.hue ?? colors.hue,
              sat: data.sat ?? colors.sat,
              textL: data.textL ?? colors.textL,
              bgL: data.bgL ?? colors.bgL,
              description: data.description,
            }
          }
          return { ...state, tags: migratedTags }
        }

        return persistedState
      },
      version: 2,
    }
  )
)
