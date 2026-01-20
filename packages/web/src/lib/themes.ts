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
    base02: '#e5e5e5',
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

// Popular themes from tinted-theming for quick access
export const POPULAR_THEMES: Base16Theme[] = [
  TEND_DARK,
  TEND_LIGHT,
  {
    system: 'base16',
    name: 'Nord',
    author: 'arcticicestudio',
    variant: 'dark',
    palette: {
      base00: '#2e3440',
      base01: '#3b4252',
      base02: '#434c5e',
      base03: '#4c566a',
      base04: '#d8dee9',
      base05: '#e5e9f0',
      base06: '#eceff4',
      base07: '#8fbcbb',
      base08: '#bf616a',
      base09: '#d08770',
      base0A: '#ebcb8b',
      base0B: '#a3be8c',
      base0C: '#88c0d0',
      base0D: '#81a1c1',
      base0E: '#b48ead',
      base0F: '#5e81ac',
    },
  },
  {
    system: 'base16',
    name: 'Gruvbox Dark',
    author: 'morhetz',
    variant: 'dark',
    palette: {
      base00: '#282828',
      base01: '#3c3836',
      base02: '#504945',
      base03: '#665c54',
      base04: '#bdae93',
      base05: '#d5c4a1',
      base06: '#ebdbb2',
      base07: '#fbf1c7',
      base08: '#fb4934',
      base09: '#fe8019',
      base0A: '#fabd2f',
      base0B: '#b8bb26',
      base0C: '#8ec07c',
      base0D: '#83a598',
      base0E: '#d3869b',
      base0F: '#d65d0e',
    },
  },
  {
    system: 'base16',
    name: 'Gruvbox Light',
    author: 'morhetz',
    variant: 'light',
    palette: {
      base00: '#fbf1c7',
      base01: '#ebdbb2',
      base02: '#d5c4a1',
      base03: '#bdae93',
      base04: '#665c54',
      base05: '#504945',
      base06: '#3c3836',
      base07: '#282828',
      base08: '#9d0006',
      base09: '#af3a03',
      base0A: '#b57614',
      base0B: '#79740e',
      base0C: '#427b58',
      base0D: '#076678',
      base0E: '#8f3f71',
      base0F: '#d65d0e',
    },
  },
  {
    system: 'base16',
    name: 'Solarized Dark',
    author: 'Ethan Schoonover',
    variant: 'dark',
    palette: {
      base00: '#002b36',
      base01: '#073642',
      base02: '#586e75',
      base03: '#657b83',
      base04: '#839496',
      base05: '#93a1a1',
      base06: '#eee8d5',
      base07: '#fdf6e3',
      base08: '#dc322f',
      base09: '#cb4b16',
      base0A: '#b58900',
      base0B: '#859900',
      base0C: '#2aa198',
      base0D: '#268bd2',
      base0E: '#6c71c4',
      base0F: '#d33682',
    },
  },
  {
    system: 'base16',
    name: 'Solarized Light',
    author: 'Ethan Schoonover',
    variant: 'light',
    palette: {
      base00: '#fdf6e3',
      base01: '#eee8d5',
      base02: '#93a1a1',
      base03: '#839496',
      base04: '#657b83',
      base05: '#586e75',
      base06: '#073642',
      base07: '#002b36',
      base08: '#dc322f',
      base09: '#cb4b16',
      base0A: '#b58900',
      base0B: '#859900',
      base0C: '#2aa198',
      base0D: '#268bd2',
      base0E: '#6c71c4',
      base0F: '#d33682',
    },
  },
  {
    system: 'base16',
    name: 'Catppuccin Mocha',
    author: 'Catppuccin',
    variant: 'dark',
    palette: {
      base00: '#1e1e2e',
      base01: '#181825',
      base02: '#313244',
      base03: '#45475a',
      base04: '#585b70',
      base05: '#cdd6f4',
      base06: '#f5e0dc',
      base07: '#b4befe',
      base08: '#f38ba8',
      base09: '#fab387',
      base0A: '#f9e2af',
      base0B: '#a6e3a1',
      base0C: '#94e2d5',
      base0D: '#89b4fa',
      base0E: '#cba6f7',
      base0F: '#f2cdcd',
    },
  },
  {
    system: 'base16',
    name: 'Catppuccin Latte',
    author: 'Catppuccin',
    variant: 'light',
    palette: {
      base00: '#eff1f5',
      base01: '#e6e9ef',
      base02: '#ccd0da',
      base03: '#bcc0cc',
      base04: '#acb0be',
      base05: '#4c4f69',
      base06: '#dc8a78',
      base07: '#7287fd',
      base08: '#d20f39',
      base09: '#fe640b',
      base0A: '#df8e1d',
      base0B: '#40a02b',
      base0C: '#179299',
      base0D: '#1e66f5',
      base0E: '#8839ef',
      base0F: '#dd7878',
    },
  },
  {
    system: 'base16',
    name: 'Tokyo Night',
    author: 'enkia',
    variant: 'dark',
    palette: {
      base00: '#1a1b26',
      base01: '#16161e',
      base02: '#2f3549',
      base03: '#444b6a',
      base04: '#787c99',
      base05: '#a9b1d6',
      base06: '#cbccd1',
      base07: '#d5d6db',
      base08: '#f7768e',
      base09: '#ff9e64',
      base0A: '#e0af68',
      base0B: '#9ece6a',
      base0C: '#7dcfff',
      base0D: '#7aa2f7',
      base0E: '#bb9af7',
      base0F: '#c0caf5',
    },
  },
  {
    system: 'base16',
    name: 'Dracula',
    author: 'Zeno Rocha',
    variant: 'dark',
    palette: {
      base00: '#282936',
      base01: '#3a3c4e',
      base02: '#4d4f68',
      base03: '#626483',
      base04: '#62d6e8',
      base05: '#e9e9f4',
      base06: '#f1f2f8',
      base07: '#f7f7fb',
      base08: '#ea51b2',
      base09: '#b45bcf',
      base0A: '#00f769',
      base0B: '#ebff87',
      base0C: '#a1efe4',
      base0D: '#62d6e8',
      base0E: '#b45bcf',
      base0F: '#00f769',
    },
  },
  {
    system: 'base16',
    name: 'Rosé Pine',
    author: 'Rosé Pine',
    variant: 'dark',
    palette: {
      base00: '#191724',
      base01: '#1f1d2e',
      base02: '#26233a',
      base03: '#6e6a86',
      base04: '#908caa',
      base05: '#e0def4',
      base06: '#e0def4',
      base07: '#524f67',
      base08: '#eb6f92',
      base09: '#f6c177',
      base0A: '#ebbcba',
      base0B: '#31748f',
      base0C: '#9ccfd8',
      base0D: '#c4a7e7',
      base0E: '#f6c177',
      base0F: '#524f67',
    },
  },
]

// Get all dark themes
export function getDarkThemes(): Base16Theme[] {
  return POPULAR_THEMES.filter((t) => t.variant === 'dark')
}

// Get all light themes
export function getLightThemes(): Base16Theme[] {
  return POPULAR_THEMES.filter((t) => t.variant === 'light')
}

// Find a theme by name
export function findTheme(name: string): Base16Theme | undefined {
  return POPULAR_THEMES.find((t) => t.name === name)
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

  // Set derived colors
  root.style.setProperty(
    '--sidebar-bg',
    `color-mix(in srgb, ${palette.base00} 90%, black)`
  )

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
