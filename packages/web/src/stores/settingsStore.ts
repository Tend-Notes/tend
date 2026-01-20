// SPDX-License-Identifier: MIT WITH Commons-Clause
// Settings state management - persisted user preferences

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Available themes (will be expanded in Phase 3)
export type ThemeName = 'one-dark' | 'nord' | 'solarized-dark' | 'solarized-light'

interface SettingsState {
  // Appearance
  theme: ThemeName
  fontSize: number // base font size in px
  lineHeight: number // line height multiplier

  // Editor
  showLineNumbers: boolean
  autoSaveDelay: number // ms

  // Git/Backup (managed by server, stored here for UI display)
  autoBackupEnabled: boolean
  autoBackupIntervalMinutes: number

  // Actions
  setTheme: (theme: ThemeName) => void
  setFontSize: (size: number) => void
  setLineHeight: (height: number) => void
  setShowLineNumbers: (show: boolean) => void
  setAutoSaveDelay: (delay: number) => void
  setAutoBackupEnabled: (enabled: boolean) => void
  setAutoBackupIntervalMinutes: (minutes: number) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // Defaults
      theme: 'one-dark',
      fontSize: 16,
      lineHeight: 1.6,
      showLineNumbers: false,
      autoSaveDelay: 1000,
      autoBackupEnabled: true,
      autoBackupIntervalMinutes: 30,

      // Actions
      setTheme: (theme) => set({ theme }),
      setFontSize: (fontSize) => set({ fontSize: Math.max(12, Math.min(24, fontSize)) }),
      setLineHeight: (lineHeight) => set({ lineHeight: Math.max(1.2, Math.min(2.0, lineHeight)) }),
      setShowLineNumbers: (showLineNumbers) => set({ showLineNumbers }),
      setAutoSaveDelay: (autoSaveDelay) => set({ autoSaveDelay: Math.max(500, Math.min(5000, autoSaveDelay)) }),
      setAutoBackupEnabled: (autoBackupEnabled) => set({ autoBackupEnabled }),
      setAutoBackupIntervalMinutes: (autoBackupIntervalMinutes) =>
        set({ autoBackupIntervalMinutes: Math.max(5, Math.min(1440, autoBackupIntervalMinutes)) }),
    }),
    {
      name: 'tend-settings',
    }
  )
)
