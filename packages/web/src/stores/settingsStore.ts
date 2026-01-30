// SPDX-License-Identifier: MIT WITH Commons-Clause
// Settings state management - persisted user preferences

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Base16Theme } from '../lib/themes'

// Theme mode: light theme, dark theme, or follow system
export type ThemeMode = 'light' | 'dark' | 'system'

// Custom theme YAML (user-provided Base16 theme)
export interface CustomTheme {
  yaml: string
  parsed: Base16Theme | null
}

// Font size presets
export type FontSizePreset = 'small' | 'medium' | 'large' | 'custom'

// Task status set choices
export type TaskStatusSet = 'todo-doing-done' | 'now-later-never'

// Task status configuration
export interface TaskStatus {
  keyword: string
  label: string
  color: string // CSS color variable name (e.g., 'base-0B' for green)
}

// Predefined status sets
export const TASK_STATUS_SETS: Record<TaskStatusSet, TaskStatus[]> = {
  'todo-doing-done': [
    { keyword: 'TODO', label: 'TODO', color: 'base-0A' },    // Yellow
    { keyword: 'DOING', label: 'DOING', color: 'base-0D' },  // Blue
    { keyword: 'DONE', label: 'DONE', color: 'base-0B' },    // Green
  ],
  'now-later-never': [
    { keyword: 'NOW', label: 'NOW', color: 'base-08' },      // Red (urgent)
    { keyword: 'LATER', label: 'LATER', color: 'base-0A' },  // Yellow
    { keyword: 'NEVER', label: 'NEVER', color: 'base-03' },  // Gray (dimmed)
  ],
}

// Content type definition
export interface ContentType {
  id: string
  name: string
  directory: string
  saveByDate: boolean // creates date subfolders like meetings/2026-01-19/
  template: string // markdown template for new sheets
}

// Default content types
const DEFAULT_CONTENT_TYPES: ContentType[] = [
  {
    id: 'page',
    name: 'Page',
    directory: 'pages',
    saveByDate: false,
    template: '',
  },
  {
    id: 'journal',
    name: 'Journal',
    directory: 'journals',
    saveByDate: true, // journals use date as filename (YYYY-MM-DD.md)
    template: '',
  },
]

interface SettingsState {
  // Appearance
  themeMode: ThemeMode
  lightThemeName: string // name of the theme to use in light mode
  darkThemeName: string // name of the theme to use in dark mode
  customLightTheme: CustomTheme | null // user-provided light theme YAML
  customDarkTheme: CustomTheme | null // user-provided dark theme YAML
  fontSizePreset: FontSizePreset
  customFontSize: number // only used when preset is 'custom'

  // Tasks
  taskStatusSet: TaskStatusSet

  // Storage (local git repo on server)
  gardenPath: string // path to the garden directory

  // Backup (remote repository)
  backupEnabled: boolean
  backupRemoteUrl: string
  backupIntervalMinutes: number
  backupAuthMethod: 'ssh' | 'https' | 'none'

  // Content Types
  contentTypes: ContentType[]

  // Graph
  currentGraphId: string | null // which graph/garden is active

  // UI state for settings panel
  openSection: string | null

  // Actions
  setThemeMode: (mode: ThemeMode) => void
  setLightThemeName: (name: string) => void
  setDarkThemeName: (name: string) => void
  setCustomLightTheme: (theme: CustomTheme | null) => void
  setCustomDarkTheme: (theme: CustomTheme | null) => void
  setFontSizePreset: (preset: FontSizePreset) => void
  setCustomFontSize: (size: number) => void
  setTaskStatusSet: (set: TaskStatusSet) => void
  setGardenPath: (path: string) => void
  setBackupEnabled: (enabled: boolean) => void
  setBackupRemoteUrl: (url: string) => void
  setBackupIntervalMinutes: (minutes: number) => void
  setBackupAuthMethod: (method: 'ssh' | 'https' | 'none') => void
  setContentTypes: (types: ContentType[]) => void
  addContentType: (type: ContentType) => void
  updateContentType: (id: string, updates: Partial<ContentType>) => void
  removeContentType: (id: string) => void
  setCurrentGraphId: (id: string | null) => void
  setOpenSection: (section: string | null) => void

  // Computed
  getEffectiveFontSize: () => number
  getTaskStatuses: () => TaskStatus[]
}

// Map presets to pixel values
const FONT_SIZE_MAP: Record<Exclude<FontSizePreset, 'custom'>, number> = {
  small: 14,
  medium: 16,
  large: 18,
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      // Defaults
      themeMode: 'dark',
      lightThemeName: 'Tend Light',
      darkThemeName: 'Tend Dark',
      customLightTheme: null,
      customDarkTheme: null,
      fontSizePreset: 'medium',
      customFontSize: 16,
      taskStatusSet: 'todo-doing-done' as TaskStatusSet,
      gardenPath: '',
      backupEnabled: false,
      backupRemoteUrl: '',
      backupIntervalMinutes: 30,
      backupAuthMethod: 'none',
      contentTypes: DEFAULT_CONTENT_TYPES,
      currentGraphId: null,
      openSection: 'appearance',

      // Actions
      setThemeMode: (themeMode) => set({ themeMode }),
      setLightThemeName: (lightThemeName) => set({ lightThemeName }),
      setDarkThemeName: (darkThemeName) => set({ darkThemeName }),
      setCustomLightTheme: (customLightTheme) => set({ customLightTheme }),
      setCustomDarkTheme: (customDarkTheme) => set({ customDarkTheme }),
      setFontSizePreset: (fontSizePreset) => set({ fontSizePreset }),
      setCustomFontSize: (customFontSize) =>
        set({ customFontSize: Math.max(10, Math.min(32, customFontSize)) }),
      setTaskStatusSet: (taskStatusSet) => set({ taskStatusSet }),
      setGardenPath: (gardenPath) => set({ gardenPath }),
      setBackupEnabled: (backupEnabled) => set({ backupEnabled }),
      setBackupRemoteUrl: (backupRemoteUrl) => set({ backupRemoteUrl }),
      setBackupIntervalMinutes: (backupIntervalMinutes) =>
        set({ backupIntervalMinutes: Math.max(5, Math.min(1440, backupIntervalMinutes)) }),
      setBackupAuthMethod: (backupAuthMethod) => set({ backupAuthMethod }),
      setContentTypes: (contentTypes) => set({ contentTypes }),
      addContentType: (type) =>
        set((state) => ({ contentTypes: [...state.contentTypes, type] })),
      updateContentType: (id, updates) =>
        set((state) => ({
          contentTypes: state.contentTypes.map((t) =>
            t.id === id ? { ...t, ...updates } : t
          ),
        })),
      removeContentType: (id) =>
        set((state) => ({
          contentTypes: state.contentTypes.filter((t) => t.id !== id),
        })),
      setCurrentGraphId: (currentGraphId) => set({ currentGraphId }),
      setOpenSection: (openSection) => set({ openSection }),

      // Computed
      getEffectiveFontSize: () => {
        const state = get()
        if (state.fontSizePreset === 'custom') {
          return state.customFontSize
        }
        return FONT_SIZE_MAP[state.fontSizePreset]
      },
      getTaskStatuses: () => {
        const state = get()
        return TASK_STATUS_SETS[state.taskStatusSet]
      },
    }),
    {
      name: 'tend-settings',
    }
  )
)
