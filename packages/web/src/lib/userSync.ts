// SPDX-License-Identifier: MIT WITH Commons-Clause
// User preferences and state synchronization
//
// Syncs user preferences and UI state with the server for multi-tenant support.
// Each user's preferences are stored on the server, not in browser localStorage.

import { user } from './api'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'
import { useGitStore } from '../stores/gitStore'
import { useRecentSheetsStore } from '../stores/recentSheetsStore'
import { useTagStore, type TagMetadata } from '../stores/tagStore'
import type { PageMeta } from '../types'

// Debounce timeout for saving to server
let prefsSaveTimeout: ReturnType<typeof setTimeout> | null = null
let stateSaveTimeout: ReturnType<typeof setTimeout> | null = null
const DEBOUNCE_MS = 1000

// Track if we're currently loading from server (to avoid save loops)
let isLoadingFromServer = false

/**
 * Load user preferences from server and apply to stores.
 * Called on app init after authenticating.
 */
export async function loadUserPrefs(): Promise<void> {
  try {
    isLoadingFromServer = true
    const prefs = await user.getPrefs()

    // Apply to settings store
    const settings = useSettingsStore.getState()
    if (prefs.themeMode !== undefined) settings.setThemeMode(prefs.themeMode as 'light' | 'dark' | 'system')
    if (prefs.lightThemeName !== undefined) settings.setLightThemeName(prefs.lightThemeName as string)
    if (prefs.darkThemeName !== undefined) settings.setDarkThemeName(prefs.darkThemeName as string)
    if (prefs.customLightTheme !== undefined) settings.setCustomLightTheme(prefs.customLightTheme as typeof settings.customLightTheme)
    if (prefs.customDarkTheme !== undefined) settings.setCustomDarkTheme(prefs.customDarkTheme as typeof settings.customDarkTheme)
    if (prefs.fontSizePreset !== undefined) settings.setFontSizePreset(prefs.fontSizePreset as 'small' | 'medium' | 'large' | 'custom')
    if (prefs.customFontSize !== undefined) settings.setCustomFontSize(prefs.customFontSize as number)
    if (prefs.taskStatusSet !== undefined) settings.setTaskStatusSet(prefs.taskStatusSet as 'todo-doing-done' | 'now-later-never')

    // Apply to git store
    const git = useGitStore.getState()
    if (prefs.autoCommitIntervalMinutes !== undefined) git.setAutoCommitInterval(prefs.autoCommitIntervalMinutes as number)
    if (prefs.smartCommitThreshold !== undefined) git.setSmartCommitThreshold(prefs.smartCommitThreshold as 'paragraph' | 'page' | 'pages')
    if (prefs.autoCommitEnabled !== undefined) git.setAutoCommitEnabled(prefs.autoCommitEnabled as boolean)

    console.log('[UserSync] Loaded preferences from server')
  } catch (err) {
    console.warn('[UserSync] Failed to load preferences:', err)
  } finally {
    isLoadingFromServer = false
  }
}

/**
 * Load user UI state from server and apply to stores.
 * Called on app init after authenticating.
 */
export async function loadUserState(): Promise<void> {
  try {
    isLoadingFromServer = true
    const state = await user.getState()

    // Apply to UI store
    const ui = useUIStore.getState()
    if (state.sidebarOpen !== undefined) {
      // Directly set state since there's no setter for boolean
      useUIStore.setState({ sidebarOpen: state.sidebarOpen as boolean })
    }
    if (state.sidebarWidth !== undefined) ui.setSidebarWidth(state.sidebarWidth as number)
    if (state.sidebarMode !== undefined) ui.setSidebarMode(state.sidebarMode as 'navigation' | 'history' | 'graph' | 'options' | 'tags' | 'todos')
    if (state.backlinksOpen !== undefined) {
      useUIStore.setState({ backlinksOpen: state.backlinksOpen as boolean })
    }
    if (state.graphOpen !== undefined) {
      useUIStore.setState({ graphOpen: state.graphOpen as boolean })
    }

    // Apply to recent sheets store
    if (state.recentSheets !== undefined) {
      useRecentSheetsStore.setState({ recentSheets: state.recentSheets as Record<string, PageMeta[]> })
    }
    if (state.recentTags !== undefined) {
      useRecentSheetsStore.setState({ recentTags: state.recentTags as { name: string }[] })
    }

    // Apply to tag store
    if (state.tags !== undefined) {
      useTagStore.setState({ tags: state.tags as Record<string, TagMetadata> })
    }

    console.log('[UserSync] Loaded state from server')
  } catch (err) {
    console.warn('[UserSync] Failed to load state:', err)
  } finally {
    isLoadingFromServer = false
  }
}

/**
 * Save current preferences to server (debounced).
 */
function savePrefsToServer(): void {
  if (isLoadingFromServer) return

  if (prefsSaveTimeout) clearTimeout(prefsSaveTimeout)
  prefsSaveTimeout = setTimeout(async () => {
    const settings = useSettingsStore.getState()
    const git = useGitStore.getState()

    const prefs = {
      // Settings
      themeMode: settings.themeMode,
      lightThemeName: settings.lightThemeName,
      darkThemeName: settings.darkThemeName,
      customLightTheme: settings.customLightTheme,
      customDarkTheme: settings.customDarkTheme,
      fontSizePreset: settings.fontSizePreset,
      customFontSize: settings.customFontSize,
      taskStatusSet: settings.taskStatusSet,
      // Git
      autoCommitIntervalMinutes: git.autoCommitIntervalMinutes,
      smartCommitThreshold: git.smartCommitThreshold,
      autoCommitEnabled: git.autoCommitEnabled,
    }

    try {
      await user.savePrefs(prefs)
      console.log('[UserSync] Saved preferences to server')
    } catch (err) {
      console.error('[UserSync] Failed to save preferences:', err)
    }
  }, DEBOUNCE_MS)
}

/**
 * Save current UI state to server (debounced).
 */
function saveStateToServer(): void {
  if (isLoadingFromServer) return

  if (stateSaveTimeout) clearTimeout(stateSaveTimeout)
  stateSaveTimeout = setTimeout(async () => {
    const ui = useUIStore.getState()
    const recentSheets = useRecentSheetsStore.getState()
    const tags = useTagStore.getState()

    const state = {
      // UI
      sidebarOpen: ui.sidebarOpen,
      sidebarWidth: ui.sidebarWidth,
      sidebarMode: ui.sidebarMode,
      backlinksOpen: ui.backlinksOpen,
      graphOpen: ui.graphOpen,
      // Recent sheets
      recentSheets: recentSheets.recentSheets,
      recentTags: recentSheets.recentTags,
      // Tags
      tags: tags.tags,
    }

    try {
      await user.saveState(state)
      console.log('[UserSync] Saved state to server')
    } catch (err) {
      console.error('[UserSync] Failed to save state:', err)
    }
  }, DEBOUNCE_MS)
}

// Unsubscribe functions
let unsubSettings: (() => void) | null = null
let unsubGit: (() => void) | null = null
let unsubUI: (() => void) | null = null
let unsubRecentSheets: (() => void) | null = null
let unsubTags: (() => void) | null = null

/**
 * Start syncing stores with server.
 * Subscribe to store changes and save to server.
 */
export function startSync(): void {
  // Unsubscribe from any previous subscriptions
  stopSync()

  // Subscribe to store changes
  unsubSettings = useSettingsStore.subscribe(savePrefsToServer)
  unsubGit = useGitStore.subscribe(savePrefsToServer)
  unsubUI = useUIStore.subscribe(saveStateToServer)
  unsubRecentSheets = useRecentSheetsStore.subscribe(saveStateToServer)
  unsubTags = useTagStore.subscribe(saveStateToServer)

  console.log('[UserSync] Started sync subscriptions')
}

/**
 * Stop syncing stores with server.
 */
export function stopSync(): void {
  if (unsubSettings) { unsubSettings(); unsubSettings = null }
  if (unsubGit) { unsubGit(); unsubGit = null }
  if (unsubUI) { unsubUI(); unsubUI = null }
  if (unsubRecentSheets) { unsubRecentSheets(); unsubRecentSheets = null }
  if (unsubTags) { unsubTags(); unsubTags = null }

  if (prefsSaveTimeout) { clearTimeout(prefsSaveTimeout); prefsSaveTimeout = null }
  if (stateSaveTimeout) { clearTimeout(stateSaveTimeout); stateSaveTimeout = null }
}

/**
 * Initialize user sync: load from server and start syncing.
 */
export async function initUserSync(): Promise<void> {
  await Promise.all([loadUserPrefs(), loadUserState()])
  startSync()
}
