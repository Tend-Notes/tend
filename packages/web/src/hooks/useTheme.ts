// SPDX-License-Identifier: MIT WITH Commons-Clause
// Hook to apply themes based on user settings

import { useShallow } from 'zustand/react/shallow'
import { useEffect, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import {
  applyTheme,
  findTheme,
  getSystemThemePreference,
  subscribeToSystemTheme,
  loadThemesFromTintedTheming,
  TEND_DARK,
  TEND_LIGHT,
  type Base16Theme,
} from '../lib/themes'

export function useTheme() {
  const { themeMode, lightThemeName, darkThemeName, customLightTheme, customDarkTheme } =
    useSettingsStore(
      useShallow((s) => ({
        themeMode: s.themeMode,
        lightThemeName: s.lightThemeName,
        darkThemeName: s.darkThemeName,
        customLightTheme: s.customLightTheme,
        customDarkTheme: s.customDarkTheme,
      }))
    )

  const [systemPreference, setSystemPreference] = useState<'light' | 'dark'>(
    getSystemThemePreference
  )

  // Subscribe to system theme changes
  useEffect(() => {
    return subscribeToSystemTheme(setSystemPreference)
  }, [])

  // Load themes from tinted-theming on mount
  useEffect(() => {
    loadThemesFromTintedTheming()
  }, [])

  // Determine which variant to use based on mode
  const effectiveVariant =
    themeMode === 'system' ? systemPreference : themeMode

  // Get the appropriate theme
  const getTheme = (): Base16Theme => {
    if (effectiveVariant === 'light') {
      // Check for custom light theme first
      if (customLightTheme?.parsed) {
        return customLightTheme.parsed
      }
      // Find built-in theme by name
      return findTheme(lightThemeName) ?? TEND_LIGHT
    } else {
      // Check for custom dark theme first
      if (customDarkTheme?.parsed) {
        return customDarkTheme.parsed
      }
      // Find built-in theme by name
      return findTheme(darkThemeName) ?? TEND_DARK
    }
  }

  const currentTheme = getTheme()

  // Apply theme when it changes
  useEffect(() => {
    applyTheme(currentTheme)
  }, [currentTheme])

  // Apply font size when it changes
  const { fontSizePreset, customFontSize, getEffectiveFontSize } = useSettingsStore(useShallow((s) => ({ fontSizePreset: s.fontSizePreset, customFontSize: s.customFontSize, getEffectiveFontSize: s.getEffectiveFontSize })))
  useEffect(() => {
    document.documentElement.style.fontSize = `${getEffectiveFontSize()}px`
  }, [fontSizePreset, customFontSize, getEffectiveFontSize])

  return {
    currentTheme,
    effectiveVariant,
  }
}

// Preview a theme temporarily without persisting
export function previewTheme(theme: Base16Theme): void {
  applyTheme(theme)
}
