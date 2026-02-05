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
import { useWorkSessionStore, type WorkSession } from '../stores/workSessionStore'
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

  } catch {
    // Preferences may not exist yet for new users
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

    // Apply to work session store
    if (state.activeWorkSession !== undefined) {
      const workSession = useWorkSessionStore.getState()
      const existingSession = workSession.activeSession

      // If there's a session from server but no local session, show continue prompt
      if (state.activeWorkSession && !existingSession) {
        workSession.setActiveSession(state.activeWorkSession as WorkSession)
        workSession.setShowContinuePrompt(true)
      } else if (state.activeWorkSession) {
        workSession.setActiveSession(state.activeWorkSession as WorkSession)
      }
    }

  } catch {
    // State may not exist yet for new users
  } finally {
    isLoadingFromServer = false
  }
}

/**
 * Build the current preferences object.
 */
function buildPrefs(): Record<string, unknown> {
  const settings = useSettingsStore.getState()
  const git = useGitStore.getState()

  return {
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
}

/**
 * Build the current UI state object.
 */
function buildState(): Record<string, unknown> {
  const ui = useUIStore.getState()
  const recentSheets = useRecentSheetsStore.getState()
  const tags = useTagStore.getState()
  const workSession = useWorkSessionStore.getState()

  return {
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
    // Work session
    activeWorkSession: workSession.activeSession,
  }
}

// Track if we have pending changes
let prefsDirty = false
let stateDirty = false

/**
 * Save current preferences to server (debounced).
 */
function savePrefsToServer(): void {
  if (isLoadingFromServer) return

  prefsDirty = true
  if (prefsSaveTimeout) clearTimeout(prefsSaveTimeout)
  prefsSaveTimeout = setTimeout(async () => {
    try {
      await user.savePrefs(buildPrefs())
      prefsDirty = false
    } catch {
      // Silently fail - user prefs are not critical
    }
  }, DEBOUNCE_MS)
}

/**
 * Save current UI state to server (debounced).
 */
function saveStateToServer(): void {
  if (isLoadingFromServer) return

  stateDirty = true
  if (stateSaveTimeout) clearTimeout(stateSaveTimeout)
  stateSaveTimeout = setTimeout(async () => {
    try {
      await user.saveState(buildState())
      stateDirty = false
    } catch {
      // Silently fail - UI state is not critical
    }
  }, DEBOUNCE_MS)
}

/**
 * Flush any pending saves immediately (synchronous, for beforeunload).
 * Uses sendBeacon for reliable delivery during page unload.
 */
function flushPendingSaves(): void {
  if (prefsDirty) {
    const prefs = JSON.stringify(buildPrefs())
    navigator.sendBeacon('/api/v1/user/prefs', new Blob([prefs], { type: 'application/json' }))
    prefsDirty = false
  }
  if (stateDirty) {
    const state = JSON.stringify(buildState())
    navigator.sendBeacon('/api/v1/user/state', new Blob([state], { type: 'application/json' }))
    stateDirty = false
  }
}

// Unsubscribe functions
let unsubSettings: (() => void) | null = null
let unsubGit: (() => void) | null = null
let unsubUI: (() => void) | null = null
let unsubRecentSheets: (() => void) | null = null
let unsubTags: (() => void) | null = null
let unsubWorkSession: (() => void) | null = null

// beforeunload handler reference
let beforeUnloadHandler: (() => void) | null = null

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
  unsubWorkSession = useWorkSessionStore.subscribe(saveStateToServer)

  // Add beforeunload handler to flush pending saves when closing tab/browser
  beforeUnloadHandler = flushPendingSaves
  window.addEventListener('beforeunload', beforeUnloadHandler)
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
  if (unsubWorkSession) { unsubWorkSession(); unsubWorkSession = null }

  if (beforeUnloadHandler) {
    window.removeEventListener('beforeunload', beforeUnloadHandler)
    beforeUnloadHandler = null
  }

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
