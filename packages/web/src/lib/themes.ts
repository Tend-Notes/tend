// SPDX-License-Identifier: MIT WITH Commons-Clause
// Theme system following Base16 specification
// See: https://github.com/tinted-theming/home

// Base16 color palette structure
export interface Base16Palette {
  base00: string // Default Background
  base01: string // Lighter Background (status bars, line numbers)
  base02: string // Selection Background
  base03: string // Comments, Invisibles, Line Highlighting
  base04: string // Dark Foreground (status bars)
  base05: string // Default Foreground, Caret, Delimiters
  base06: string // Light Foreground (not often used)
  base07: string // Light Background (not often used)
  base08: string // Variables, XML Tags, Markup Link Text, Markup Lists, Diff Deleted
  base09: string // Integers, Boolean, Constants, XML Attributes, Markup Link Url
  base0A: string // Classes, Markup Bold, Search Text Background
  base0B: string // Strings, Inherited Class, Markup Code, Diff Inserted
  base0C: string // Support, Regular Expressions, Escape Characters, Markup Quotes
  base0D: string // Functions, Methods, Attribute IDs, Headings
  base0E: string // Keywords, Storage, Selector, Markup Italic, Diff Changed
  base0F: string // Deprecated, Opening/Closing Embedded Language Tags
}

// Full theme definition following tinted-theming spec
export interface Base16Theme {
  system: 'base16'
  name: string
  author: string
  variant: 'light' | 'dark'
  palette: Base16Palette
}

// Built-in Tend Dark theme (based on One Dark)
export const TEND_DARK: Base16Theme = {
  system: 'base16',
  name: 'Tend Dark',
  author: 'Tend',
  variant: 'dark',
  palette: {
    base00: '#282c34',
    base01: '#353b45',
    base02: '#3e4451',
    base03: '#545862',
    base04: '#565c64',
    base05: '#abb2bf',
    base06: '#b6bdca',
    base07: '#c8ccd4',
    base08: '#e06c75',
    base09: '#d19a66',
    base0A: '#e5c07b',
    base0B: '#98c379',
    base0C: '#56b6c2',
    base0D: '#61afef',
    base0E: '#c678dd',
    base0F: '#be5046',
  },
}

// Built-in Tend Light theme
export const TEND_LIGHT: Base16Theme = {
  system: 'base16',
  name: 'Tend Light',
  author: 'Tend',
  variant: 'light',
  palette: {
    base00: '#fafafa',
    base01: '#f0f0f0',
    base02: '#e0e0e0', // Slightly darker for visible button contrast
    base03: '#a0a1a7',
    base04: '#696c77',
    base05: '#383a42',
    base06: '#202227',
    base07: '#090a0b',
    base08: '#e45649',
    base09: '#986801',
    base0A: '#c18401',
    base0B: '#50a14f',
    base0C: '#0184bc',
    base0D: '#4078f2',
    base0E: '#a626a4',
    base0F: '#ca1243',
  },
}

// Built-in themes (always available, even offline)
export const BUILTIN_THEMES: Base16Theme[] = [TEND_DARK, TEND_LIGHT]

// Theme cache for fetched themes
interface ThemeCache {
  themes: Base16Theme[]
  lastFetched: number
  isLoading: boolean
  error: string | null
}

// LocalStorage key for persistent cache
const THEME_CACHE_KEY = 'tend-theme-cache'

// Cache duration: 24 hours (reduced network requests significantly)
const CACHE_DURATION = 24 * 60 * 60 * 1000

// Stored cache format (subset of ThemeCache that we persist)
interface StoredCache {
  themes: Base16Theme[]
  lastFetched: number
}

// Try to restore cache from localStorage
function restoreCache(): ThemeCache {
  try {
    const stored = localStorage.getItem(THEME_CACHE_KEY)
    if (stored) {
      const parsed: StoredCache = JSON.parse(stored)
      // Validate the stored data has expected shape
      if (
        Array.isArray(parsed.themes) &&
        typeof parsed.lastFetched === 'number' &&
        parsed.themes.length > 0
      ) {
        // Merge with built-in themes (in case builtins were updated)
        const builtinNames = new Set(BUILTIN_THEMES.map((t) => t.name))
        const restoredThemes = [
          ...BUILTIN_THEMES,
          ...parsed.themes.filter((t) => !builtinNames.has(t.name)),
        ]
        return {
          themes: restoredThemes,
          lastFetched: parsed.lastFetched,
          isLoading: false,
          error: null,
        }
      }
    }
  } catch {
    // Failed to restore cache - start fresh
  }
  // Return fresh cache if restore fails
  return {
    themes: [...BUILTIN_THEMES],
    lastFetched: 0,
    isLoading: false,
    error: null,
  }
}

// Persist cache to localStorage
function persistCache(cache: ThemeCache): void {
  try {
    const toStore: StoredCache = {
      themes: cache.themes,
      lastFetched: cache.lastFetched,
    }
    localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(toStore))
  } catch {
    // Failed to persist cache - not critical
  }
}

// Initialize cache from localStorage
const themeCache: ThemeCache = restoreCache()

// GitHub API URL for tinted-theming base16 schemes
const SCHEMES_API_URL = 'https://api.github.com/repos/tinted-theming/schemes/contents/base16'
const RAW_CONTENT_BASE = 'https://raw.githubusercontent.com/tinted-theming/schemes/spec-0.11/base16'

// Listeners for theme updates
type ThemeListener = (themes: Base16Theme[]) => void
const listeners = new Set<ThemeListener>()

export function subscribeToThemes(listener: ThemeListener): () => void {
  listeners.add(listener)
  // Immediately call with current themes
  listener(themeCache.themes)
  return () => listeners.delete(listener)
}

function notifyListeners() {
  listeners.forEach((listener) => listener(themeCache.themes))
}

// Fetch available theme files from GitHub
async function fetchThemeList(): Promise<string[]> {
  const response = await fetch(SCHEMES_API_URL)
  if (!response.ok) {
    throw new Error(`Failed to fetch theme list: ${response.status}`)
  }
  const files = await response.json()
  return files
    .filter((f: { name: string }) => f.name.endsWith('.yaml') && f.name !== 'README.md')
    .map((f: { name: string }) => f.name.replace('.yaml', ''))
}

// Fetch a single theme's YAML content
async function fetchThemeYaml(name: string): Promise<string> {
  const response = await fetch(`${RAW_CONTENT_BASE}/${name}.yaml`)
  if (!response.ok) {
    throw new Error(`Failed to fetch theme ${name}: ${response.status}`)
  }
  return response.text()
}

// Load themes from tinted-theming (called on app init)
export async function loadThemesFromTintedTheming(): Promise<void> {
  // Don't refetch if cache is fresh
  if (Date.now() - themeCache.lastFetched < CACHE_DURATION && themeCache.themes.length > 2) {
    return
  }

  if (themeCache.isLoading) {
    return
  }

  themeCache.isLoading = true
  themeCache.error = null

  try {
    const themeNames = await fetchThemeList()

    // Fetch themes in batches to avoid rate limiting
    const BATCH_SIZE = 10
    const fetchedThemes: Base16Theme[] = []

    for (let i = 0; i < themeNames.length; i += BATCH_SIZE) {
      const batch = themeNames.slice(i, i + BATCH_SIZE)
      const results = await Promise.allSettled(
        batch.map(async (name) => {
          const yaml = await fetchThemeYaml(name)
          return parseBase16Yaml(yaml)
        })
      )

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          fetchedThemes.push(result.value)
        }
      }
    }

    // Merge with built-in themes (built-in takes precedence)
    const builtinNames = new Set(BUILTIN_THEMES.map((t) => t.name))
    const newThemes = [
      ...BUILTIN_THEMES,
      ...fetchedThemes.filter((t) => !builtinNames.has(t.name)),
    ]

    // Sort alphabetically (but keep Tend themes at top)
    newThemes.sort((a, b) => {
      if (a.name.startsWith('Tend') && !b.name.startsWith('Tend')) return -1
      if (!a.name.startsWith('Tend') && b.name.startsWith('Tend')) return 1
      return a.name.localeCompare(b.name)
    })

    themeCache.themes = newThemes
    themeCache.lastFetched = Date.now()
    persistCache(themeCache)
    notifyListeners()
  } catch (error) {
    themeCache.error = error instanceof Error ? error.message : 'Failed to load themes'
    console.error('Failed to load themes from tinted-theming:', error)
  } finally {
    themeCache.isLoading = false
  }
}

// Get all available themes (built-in + fetched)
export function getAllThemes(): Base16Theme[] {
  return themeCache.themes
}

// Get all dark themes
export function getDarkThemes(): Base16Theme[] {
  return themeCache.themes.filter((t) => t.variant === 'dark')
}

// Get all light themes
export function getLightThemes(): Base16Theme[] {
  return themeCache.themes.filter((t) => t.variant === 'light')
}

// Find a theme by name
export function findTheme(name: string): Base16Theme | undefined {
  return themeCache.themes.find((t) => t.name === name)
}

// Check if themes are still loading
export function isLoadingThemes(): boolean {
  return themeCache.isLoading
}

// Get theme loading error
export function getThemeError(): string | null {
  return themeCache.error
}

// Parse a Base16 YAML string into a theme object
export function parseBase16Yaml(yaml: string): Base16Theme | null {
  try {
    const lines = yaml.split('\n')
    const theme: Partial<Base16Theme> = {
      system: 'base16',
      palette: {} as Base16Palette,
    }

    let inPalette = false

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      if (trimmed === 'palette:') {
        inPalette = true
        continue
      }

      const match = trimmed.match(/^(\w+):\s*["']?([^"']+)["']?$/)
      if (!match) continue

      const [, key, value] = match

      if (inPalette && key.startsWith('base0')) {
        const color = value.startsWith('#') ? value : `#${value}`
        ;(theme.palette as unknown as Record<string, string>)[key] = color
      } else if (key === 'name') {
        theme.name = value
      } else if (key === 'author') {
        theme.author = value
      } else if (key === 'variant') {
        theme.variant = value as 'light' | 'dark'
      }
    }

    // Validate we have all required fields
    if (!theme.name || !theme.palette) return null

    const palette = theme.palette as Base16Palette
    const requiredKeys = [
      'base00', 'base01', 'base02', 'base03', 'base04', 'base05',
      'base06', 'base07', 'base08', 'base09', 'base0A', 'base0B',
      'base0C', 'base0D', 'base0E', 'base0F',
    ]
    for (const key of requiredKeys) {
      if (!(key in palette)) return null
    }

    return {
      system: 'base16',
      name: theme.name,
      author: theme.author || 'Unknown',
      variant: theme.variant || 'dark',
      palette,
    }
  } catch {
    return null
  }
}

// Apply a theme to the document by setting CSS variables
export function applyTheme(theme: Base16Theme): void {
  const root = document.documentElement
  const { palette } = theme

  // Set base16 variables
  root.style.setProperty('--base00', palette.base00)
  root.style.setProperty('--base01', palette.base01)
  root.style.setProperty('--base02', palette.base02)
  root.style.setProperty('--base03', palette.base03)
  root.style.setProperty('--base04', palette.base04)
  root.style.setProperty('--base05', palette.base05)
  root.style.setProperty('--base06', palette.base06)
  root.style.setProperty('--base07', palette.base07)
  root.style.setProperty('--base08', palette.base08)
  root.style.setProperty('--base09', palette.base09)
  root.style.setProperty('--base0A', palette.base0A)
  root.style.setProperty('--base0B', palette.base0B)
  root.style.setProperty('--base0C', palette.base0C)
  root.style.setProperty('--base0D', palette.base0D)
  root.style.setProperty('--base0E', palette.base0E)
  root.style.setProperty('--base0F', palette.base0F)

  // Set derived colors based on theme variant
  if (theme.variant === 'light') {
    // Light themes: darken sidebar and button backgrounds
    root.style.setProperty(
      '--sidebar-bg',
      `color-mix(in srgb, ${palette.base00} 95%, ${palette.base03})`
    )
    // For light themes, buttons should be darker than the background
    root.style.setProperty('--btn-bg', palette.base02)
    root.style.setProperty('--btn-bg-hover', palette.base03)
    root.style.setProperty('--btn-bg-active', palette.base01)
  } else {
    // Dark themes: standard behavior
    root.style.setProperty(
      '--sidebar-bg',
      `color-mix(in srgb, ${palette.base00} 90%, black)`
    )
    root.style.setProperty('--btn-bg', palette.base02)
    root.style.setProperty('--btn-bg-hover', palette.base03)
    root.style.setProperty('--btn-bg-active', palette.base01)
  }

  // Set color-scheme for native elements
  root.style.colorScheme = theme.variant
}

// Get system preference for light/dark
export function getSystemThemePreference(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// Subscribe to system theme changes
export function subscribeToSystemTheme(
  callback: (preference: 'light' | 'dark') => void
): () => void {
  if (typeof window === 'undefined') return () => {}

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = (e: MediaQueryListEvent) => {
    callback(e.matches ? 'dark' : 'light')
  }

  mediaQuery.addEventListener('change', handler)
  return () => mediaQuery.removeEventListener('change', handler)
}
