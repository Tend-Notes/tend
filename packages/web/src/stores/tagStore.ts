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
// These are theme-independent, chosen for good coverage of the color wheel
const TAG_COLORS = [
  '#e06c75', // red
  '#d19a66', // orange
  '#e5c07b', // yellow
  '#98c379', // green
  '#56b6c2', // cyan
  '#61afef', // blue
  '#c678dd', // purple
  '#be5046', // brown
]

// Minimum contrast ratio (WCAG AA for large text is 3:1, we use 4:1 for safety)
const MIN_CONTRAST_RATIO = 4.0

/**
 * Parse hex color to RGB values
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return { r: 128, g: 128, b: 128 }
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  }
}

/**
 * Calculate relative luminance per WCAG 2.1
 */
function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    c = c / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}

/**
 * Calculate contrast ratio between two colors
 */
function getContrastRatio(hex1: string, hex2: string): number {
  const rgb1 = hexToRgb(hex1)
  const rgb2 = hexToRgb(hex2)
  const l1 = getLuminance(rgb1.r, rgb1.g, rgb1.b)
  const l2 = getLuminance(rgb2.r, rgb2.g, rgb2.b)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Convert RGB to HSL
 */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }
  return { h, s, l }
}

/**
 * Convert HSL to hex
 */
function hslToHex(h: number, s: number, l: number): string {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1/6) return p + (q - p) * 6 * t
    if (t < 1/2) return q
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6
    return p
  }

  let r, g, b
  if (s === 0) {
    r = g = b = l
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1/3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1/3)
  }

  const toHex = (x: number) => {
    const hex = Math.round(x * 255).toString(16)
    return hex.length === 1 ? '0' + hex : hex
  }
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/**
 * Adjust color lightness to meet minimum contrast against background
 */
function ensureContrast(color: string, backgroundColor: string): string {
  const contrast = getContrastRatio(color, backgroundColor)
  if (contrast >= MIN_CONTRAST_RATIO) {
    return color
  }

  // Need to adjust - determine if background is light or dark
  const bgRgb = hexToRgb(backgroundColor)
  const bgLuminance = getLuminance(bgRgb.r, bgRgb.g, bgRgb.b)
  const isLightBg = bgLuminance > 0.5

  // Convert to HSL and adjust lightness
  const rgb = hexToRgb(color)
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b)

  // Binary search for the right lightness
  let minL = isLightBg ? 0 : hsl.l
  let maxL = isLightBg ? hsl.l : 1
  let bestColor = color

  for (let i = 0; i < 10; i++) {
    const midL = (minL + maxL) / 2
    const testColor = hslToHex(hsl.h, hsl.s, midL)
    const testContrast = getContrastRatio(testColor, backgroundColor)

    if (testContrast >= MIN_CONTRAST_RATIO) {
      bestColor = testColor
      if (isLightBg) {
        minL = midL // Try to stay closer to original (lighter)
      } else {
        maxL = midL // Try to stay closer to original (darker)
      }
    } else {
      if (isLightBg) {
        maxL = midL // Need darker
      } else {
        minL = midL // Need lighter
      }
    }
  }

  return bestColor
}

/**
 * Get the current background color from CSS variables
 */
function getBackgroundColor(): string {
  if (typeof window === 'undefined') return '#1e1e1e'
  const style = getComputedStyle(document.documentElement)
  const bg = style.getPropertyValue('--base-00').trim()
  return bg || '#1e1e1e'
}

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
        const baseColor = tag?.color || hashTagToColor(tagName)
        // Ensure contrast against current background
        return ensureContrast(baseColor, getBackgroundColor())
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
