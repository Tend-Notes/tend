// SPDX-License-Identifier: MIT WITH Commons-Clause
// User preferences and state synchronization
//
// Syncs user preferences and UI state with the server for multi-tenant support.
// Each user's preferences are stored on the server, not in browser localStorage.
//
// A local-folder garden's files never reach the server, and the UI-state payload
// is full of its content: recentSheets carries sheet names and titles, tags and
// recentTags carry tag names, and activeWorkSession carries a page name and
// taskContent — the literal text of a task block. So the state sync is
// suspended outright while a local garden is active (see suspendsState below),
// and the garden-scoped stores are emptied on every switch so one garden's
// content cannot be posted under the next garden's session.
//
// Preferences keep syncing: buildPrefs carries themes, font sizing, the
// task-status vocabulary and git settings — numbers and fixed enums, no garden
// content — and a theme changed inside a local garden should stick.

import { user } from './api'
import { isLocalGarden, onBackendChange } from './backend'
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
 * Whether the UI-state payload may be sent at all.
 *
 * Filtering it down to its content-free fields is not an option: POST
 * /user/state replaces the whole blob and the blob is per user rather than per
 * garden, so a reduced payload sent from a local garden would overwrite the
 * server garden's recents, tags and work session with nothing. Suspending the
 * send leaves the stored blob exactly as the last server garden left it.
 *
 * What it costs is sidebar geometry not being written back during a local
 * session, which the next load restores from the server anyway.
 */
function statePayloadAllowed(): boolean {
  return !isLocalGarden()
}

/**
 * Run a store update that came from the server, not from the user.
 *
 * The subscriptions treat every store change as something to save back;
 * applying server data under this guard keeps that from bouncing straight
 * back as a POST.
 */
export function withoutSync(apply: () => void): void {
  const previous = isLoadingFromServer
  isLoadingFromServer = true
  try {
    apply()
  } finally {
    isLoadingFromServer = previous
  }
}

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
    // Seed the snapshot: whatever is in the stores now IS what the server has,
    // so an unrelated subscription firing on a cold load sends nothing.
    lastSentPrefs = JSON.stringify(buildPrefs())
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
    // Same seeding as prefs: the stores now mirror the server.
    lastSentState = JSON.stringify(buildState())
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

// Last payload actually sent, serialized. The subscriptions fire on any change
// to their stores, including fields these payloads don't carry — uiStore's
// lastFocusedBlockUuid is written every time the caret crosses a block
// boundary, so plain typing used to POST the identical UI-state JSON once per
// editing pause. Comparing against what was last sent drops those.
let lastSentPrefs: string | null = null
let lastSentState: string | null = null

/**
 * Save current preferences to server (debounced).
 */
function savePrefsToServer(): void {
  if (isLoadingFromServer) return

  prefsDirty = true
  if (prefsSaveTimeout) clearTimeout(prefsSaveTimeout)
  prefsSaveTimeout = setTimeout(async () => {
    const prefs = buildPrefs()
    const serialized = JSON.stringify(prefs)
    if (serialized === lastSentPrefs) {
      prefsDirty = false
      return
    }
    try {
      await user.savePrefs(prefs)
      lastSentPrefs = serialized
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
  if (!statePayloadAllowed()) return

  stateDirty = true
  if (stateSaveTimeout) clearTimeout(stateSaveTimeout)
  stateSaveTimeout = setTimeout(async () => {
    const state = buildState()
    const serialized = JSON.stringify(state)
    if (serialized === lastSentState) {
      stateDirty = false
      return
    }
    try {
      await user.saveState(state)
      lastSentState = serialized
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
    if (prefs !== lastSentPrefs) {
      navigator.sendBeacon('/api/v1/user/prefs', new Blob([prefs], { type: 'application/json' }))
      lastSentPrefs = prefs
    }
    prefsDirty = false
  }
  if (stateDirty) {
    // Guarded again rather than relying on stateDirty never being set while a
    // local garden is active: the beacon is the path that bypasses the
    // debounce, so it gets its own check. A pending server-garden payload
    // dropped by a switch is no loss — the next load reads it back.
    if (statePayloadAllowed()) {
      const state = JSON.stringify(buildState())
      if (state !== lastSentState) {
        navigator.sendBeacon('/api/v1/user/state', new Blob([state], { type: 'application/json' }))
        lastSentState = state
      }
    }
    stateDirty = false
  }
}

/**
 * Empty the stores whose contents are garden content.
 *
 * Visiting a sheet or touching a tag records it in these stores, so straight
 * after a garden switch they still hold the *previous* garden's names and
 * titles. Left alone, the next server garden's first save would post the
 * previous garden's content under its session — and where the previous garden
 * was local, that content was never meant to leave the machine at all.
 *
 * Runs under withoutSync, so emptying them does not itself trigger a save.
 */
function clearGardenScopedStores(): void {
  withoutSync(() => {
    useRecentSheetsStore.getState().reset()
    useTagStore.getState().reset()
    useWorkSessionStore.getState().clearSession()
  })
}

/**
 * Handle a backend switch: drop the old garden's content, then repopulate from
 * the server if the new garden is one the server serves. A local garden has
 * nothing to repopulate from here — its own UI state lives in its folder.
 */
async function onGardenSwitch(): Promise<void> {
  clearGardenScopedStores()
  if (statePayloadAllowed()) await loadUserState()
}

// Unsubscribe functions
let unsubSettings: (() => void) | null = null
let unsubGit: (() => void) | null = null
let unsubUI: (() => void) | null = null
let unsubRecentSheets: (() => void) | null = null
let unsubTags: (() => void) | null = null
let unsubWorkSession: (() => void) | null = null
let unsubBackend: (() => void) | null = null

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
  unsubBackend = onBackendChange(() => {
    void onGardenSwitch()
  })

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
  if (unsubBackend) { unsubBackend(); unsubBackend = null }

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
