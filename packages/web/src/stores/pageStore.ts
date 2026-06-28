// SPDX-License-Identifier: MIT WITH Commons-Clause
// Page and navigation state management

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Page, Block, CursorPosition } from '../types'
import * as api from '../lib/api'
import { VersionConflictError } from '../lib/api'
import * as draftStore from '../lib/draftStore'
import { useActivityLogStore } from './activityLogStore'
import { useSyncStatusStore } from './syncStatusStore'
import { useSettingsStore, type ContentType } from './settingsStore'
import { parseName, splitName } from '../lib/name'
import { useRecentSheetsStore } from './recentSheetsStore'
import { formatDateYMD } from '../lib/dateUtils'

interface PageState {
  // Current page/journal being viewed
  currentPage: Page | null
  currentPageName: string | null

  // Loading states
  isLoading: boolean
  initialized: boolean
  error: string | null

  // Draft state
  pendingDraftRecovery: {
    pageName: string
    blocks: Block[]
    rootBlocks: string[]
    savedAt: number
  } | null

  // Conflict state
  pendingConflict: {
    currentVersion: number
    localBlocks: Block[]
    localRootBlocks: string[]
  } | null

  // Template editing state
  editingTemplate: {
    contentTypeId: string
    contentTypeName: string
    page: Page
    hasUnsavedChanges: boolean
  } | null

  // Import error editing state
  editingImportError: {
    errorName: string
    originalName: string
    error: string
    timestamp: string
    page: Page
    fileName: string
    hasUnsavedChanges: boolean
  } | null

  // Task manager viewing state
  viewingTasks: boolean

  // Pending cursor position from template creation
  // This is consumed by the editor when it mounts to position the cursor
  pendingCursorPosition: CursorPosition | null

  // Pending scroll target - block UUID to scroll to after navigation
  // Used when clicking tasks in sidebar or block references
  pendingScrollTarget: string | null

  // Actions
  loadTodaysJournal: () => Promise<void>
  navigateToPage: (name: string, pushHistory?: boolean) => Promise<void>
  navigateToJournal: (date: string, pushHistory?: boolean) => Promise<void>
  createPage: (name: string) => Promise<void>
  deletePage: (name: string) => Promise<void>
  updateCurrentPage: (blocks: Block[], rootBlocksHint?: string[]) => Promise<void>
  setError: (error: string | null) => void
  initializeFromUrl: () => Promise<void>
  restoreDraft: () => void
  discardDraft: () => Promise<void>
  // Conflict resolution
  resolveConflictKeepMine: () => Promise<void>
  resolveConflictKeepServer: () => Promise<void>
  dismissConflict: () => void
  // Flush any pending saves immediately (called before navigation)
  flushPendingSave: () => Promise<void>
  // Clear the recent files history
  clearRecentFiles: () => void
  // Reset all state to initial values (for switching gardens)
  reset: () => void
  // Update a property on the current page
  updateCurrentPageProperty: (key: string, value: string | null) => Promise<void>
  // Template editing actions
  openTemplateEditor: (contentTypeId: string, contentTypeName: string) => Promise<void>
  updateTemplate: (blocks: Block[], rootBlocksHint?: string[]) => void
  saveTemplate: () => Promise<void>
  closeTemplateEditor: () => void
  // Consume pending cursor position (called by editor on mount)
  consumePendingCursorPosition: () => CursorPosition | null
  // Set pending scroll target (called before navigation)
  setPendingScrollTarget: (uuid: string | null) => void
  // Consume pending scroll target (called by editor after mount)
  consumePendingScrollTarget: () => string | null
  // Import error editing actions
  openImportErrorEditor: (errorName: string) => Promise<void>
  updateImportError: (blocks: Block[], rootBlocksHint?: string[]) => void
  updateImportErrorFileName: (fileName: string) => void
  saveImportError: (contentType: string, date?: string) => Promise<void>
  discardImportError: () => Promise<void>
  closeImportErrorEditor: () => void
  // Task manager actions
  openTaskManager: () => Promise<void>
  closeTaskManager: () => void
}

// Helper to build URL path for content
// Encodes each path segment separately to preserve directory structure
//
// URL structure:
// - Journals: /journal/YYYY-MM-DD
// - Pages: /page/name
// - Custom content types: /content-type-dir/name (e.g., /person/John%20Smith)
function buildUrlPath(type: 'page' | 'journal' | 'content-type', name: string): string {
  const encodedSegments = name.split('/').map(segment => encodeURIComponent(segment))
  // Get base path from Vite (e.g., '/tend/' for GitHub Pages demo, '/' normally)
  // Remove trailing slash to avoid double slashes
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  if (type === 'content-type') {
    // Content types go directly at root: /tend/person/John%20Smith
    return `${base}/${encodedSegments.join('/')}`
  }
  return `${base}/${type}/${encodedSegments.join('/')}`
}

// Helper to parse URL path into type and name
// Decodes each path segment separately to preserve directory structure
//
// Returns:
// - { type: 'journal', name: 'YYYY-MM-DD' } for /journal/YYYY-MM-DD
// - { type: 'page', name: 'pagename' } for /page/pagename
// - { type: 'content-type', name: 'person/John Smith' } for /person/John%20Smith
function parseUrlPath(path: string): { type: 'page' | 'journal' | 'content-type' | null; name: string | null } {
  // Strip base path (e.g., '/tend/' for GitHub Pages demo)
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  const normalizedPath = base && path.startsWith(base) ? path.slice(base.length) : path

  // Check for journal or page prefix first
  const match = normalizedPath.match(/^\/(page|journal)\/(.+)$/)
  if (match) {
    const decodedSegments = match[2].split('/').map(segment => decodeURIComponent(segment))
    return { type: match[1] as 'page' | 'journal', name: decodedSegments.join('/') }
  }

  // Check for content type paths (e.g., /person/John%20Smith or /meeting/2026-01-23/Name)
  // These are at root level with format: /directory/... (remaining path)
  const contentTypeMatch = normalizedPath.match(/^\/([^/]+)\/(.+)$/)
  if (contentTypeMatch) {
    const directory = decodeURIComponent(contentTypeMatch[1])
    // Decode each segment separately to handle paths like /meeting/2026-01-23/Name%20Here
    const remainingSegments = contentTypeMatch[2].split('/').map(segment => decodeURIComponent(segment))
    // Return the full path as name (directory/remaining/segments)
    return { type: 'content-type', name: `${directory}/${remainingSegments.join('/')}` }
  }

  return { type: null, name: null }
}

// Debounce helper for server saves
let saveTimeout: ReturnType<typeof setTimeout> | null = null
const SAVE_DEBOUNCE_MS = 500

// Debounce helper for draft saves (faster than server saves)
let draftTimeout: ReturnType<typeof setTimeout> | null = null
const DRAFT_DEBOUNCE_MS = 300

// Store pending save data so we can flush it immediately on navigation
let pendingSaveData: {
  pageName: string
  blocks: Block[]
  contentType: string
  isJournal: boolean
  journalDate: string | null
} | null = null

// Track when the last successful save completed for the current page
// Used to ignore file watcher events that are for our own saves
let lastSaveTimestamp: number = 0

// Grace period after a save during which file watcher events are ignored
// This prevents race conditions where the file watcher triggers faster
// than we can update sync status
const SAVE_GRACE_PERIOD_MS = 2000

/**
 * Check if a file watcher reload should be skipped.
 * Returns true if:
 * - There are unsaved changes in the editor
 * - There's a pending debounced save
 * - We just completed a save recently (within grace period)
 */
export function shouldSkipFileWatcherReload(): boolean {
  // Check for unsaved changes via syncStatusStore (single source of truth)
  const hasUnsaved = useSyncStatusStore.getState().status === 'unsaved'
  if (hasUnsaved) return true

  // Check for pending debounced save
  if (pendingSaveData !== null) return true

  // Check if we're within the save grace period
  if (Date.now() - lastSaveTimestamp < SAVE_GRACE_PERIOD_MS) return true

  return false
}

// Helper to extract sheet name from full page name for custom content types
// For saveByDate types: "meeting/2026-01-30/Standup" -> "Standup"
// For non-saveByDate types: "person/John Smith" -> "John Smith"
function extractSheetName(contentType: ContentType, pageName: string): string {
  return splitName(contentType, pageName).bareName
}

// Helper to extract date from page name for date-foldered content types
// "meeting/2026-01-30/Standup" -> "2026-01-30"
function extractDateFromPageName(contentType: ContentType, pageName: string): string | undefined {
  return splitName(contentType, pageName).date
}

// Helper to record sheet access in the recent sheets store
function recordSheetAccess(page: Page) {
  // Tag pages go to recentTags, not recentSheets
  if (page.name.startsWith('tags/')) {
    const tagName = page.name.slice('tags/'.length)
    useRecentSheetsStore.getState().recordTagAccess(tagName)
    return
  }

  useRecentSheetsStore.getState().recordAccess(page.contentType, {
    name: page.name,
    title: page.title,
    contentType: page.contentType,
    isJournal: page.isJournal,
    journalDate: page.journalDate,
    blockCount: Object.keys(page.blocks).length,
    createdAt: page.createdAt,
    modifiedAt: page.modifiedAt,
  })
}

export const usePageStore = create<PageState>()(
  immer((set, get) => ({
    currentPage: null,
    currentPageName: null,
    isLoading: false,
    initialized: false,
    error: null,
    pendingDraftRecovery: null,
    pendingConflict: null,
    editingTemplate: null,
    editingImportError: null,
    viewingTasks: false,
    pendingCursorPosition: null,
    pendingScrollTarget: null,

    loadTodaysJournal: async () => {
      // Use browser's local date, not server's, so "Today" works correctly
      // when traveling across timezones
      const today = formatDateYMD(new Date())
      return get().navigateToJournal(today)
    },

    navigateToPage: async (name: string, pushHistory = true) => {
      // Flush any pending saves before navigating away
      await get().flushPendingSave()

      // Reset save timestamp when navigating to prevent old timestamps
      // from affecting the new page's file watcher handling
      lastSaveTimestamp = 0

      set((state) => {
        state.isLoading = true
        state.error = null
        state.pendingDraftRecovery = null
        state.viewingTasks = false
      })

      // Reset sync status when navigating to a new page
      useSyncStatusStore.getState().reset()

      // Check if this is a content type path (e.g., "person/John Smith" or "meeting/2026-01-23/Name")
      // by looking for a matching content type directory
      const contentTypes = useSettingsStore.getState().contentTypes
      // Decompose via the shared name authority: a known directory prefix means
      // a custom type; anything else is a page (the bare fallback).
      const parsed = parseName(name, contentTypes)
      const contentType =
        parsed.contentTypeId === 'page'
          ? null
          : contentTypes.find((ct) => ct.id === parsed.contentTypeId) ?? null
      const sheetName = parsed.bareName
      const sheetDate = parsed.date

      try {
        // Use sheets API for content type paths, pages API for regular pages
        const page = contentType
          ? await api.sheets.get(contentType.id, sheetName, sheetDate)
          : await api.pages.get(name)

        // Check for stale draft
        const draft = await draftStore.getDraft(page.name)
        if (draft && draft.serverVersion !== page.modifiedAt) {
          // Found a draft that differs from server - offer recovery
          set((state) => {
            state.currentPage = page
            state.currentPageName = name
            state.isLoading = false
            state.pendingDraftRecovery = {
              pageName: draft.pageName,
              blocks: draft.blocks,
              rootBlocks: draft.rootBlocks,
              savedAt: draft.savedAt,
            }
          })
        } else {
          // No stale draft - clear any existing draft for this page
          if (draft) {
            await draftStore.deleteDraft(page.name)
          }
          set((state) => {
            state.currentPage = page
            state.currentPageName = name
            state.isLoading = false
          })
        }

        // Record this access in recent sheets
        recordSheetAccess(page)

        // Update browser history
        if (pushHistory) {
          // Use content-type URL path for custom content types, page path for regular pages
          const urlType = contentType ? 'content-type' : 'page'
          const url = buildUrlPath(urlType, name)
          window.history.pushState({ type: urlType, name }, '', url)
        }
      } catch (e) {
        // If page doesn't exist (404), create it
        if (e instanceof Error && e.message.includes('404')) {
          try {
            // Create sheet or page based on content type
            let newPage: Page
            let cursorPosition: CursorPosition | null = null

            if (contentType) {
              // Create sheet - may return cursor position from template
              const response = await api.sheets.create(contentType.id, sheetName, { date: sheetDate })
              // Extract cursor position before treating response as Page
              cursorPosition = response.cursorPosition ?? null
              newPage = response
            } else {
              newPage = await api.pages.create(name)
            }

            set((state) => {
              state.currentPage = newPage
              state.currentPageName = name
              state.isLoading = false
              // Store cursor position to be consumed by editor
              state.pendingCursorPosition = cursorPosition
            })
            // Record this access in recent sheets
            recordSheetAccess(newPage)
            // Update browser history
            if (pushHistory) {
              const urlType = contentType ? 'content-type' : 'page'
              const url = buildUrlPath(urlType, name)
              window.history.pushState({ type: urlType, name }, '', url)
            }
            return
          } catch (createErr) {
            set((state) => {
              state.error = createErr instanceof Error ? createErr.message : 'Failed to create page'
              state.isLoading = false
            })
            return
          }
        }
        set((state) => {
          state.error = e instanceof Error ? e.message : 'Failed to load page'
          state.isLoading = false
        })
      }
    },

    navigateToJournal: async (date: string, pushHistory = true) => {
      // Flush any pending saves before navigating away
      await get().flushPendingSave()

      // Reset save timestamp when navigating to prevent old timestamps
      // from affecting the new page's file watcher handling
      lastSaveTimestamp = 0

      set((state) => {
        state.isLoading = true
        state.error = null
        state.pendingDraftRecovery = null
        state.viewingTasks = false
      })

      // Reset sync status when navigating to a new page
      useSyncStatusStore.getState().reset()

      try {
        const page = await api.journals.get(date)

        // Check for stale draft
        const draft = await draftStore.getDraft(page.name)
        if (draft && draft.serverVersion !== page.modifiedAt) {
          // Found a draft that differs from server - offer recovery
          set((state) => {
            state.currentPage = page
            state.currentPageName = date
            state.isLoading = false
            state.pendingDraftRecovery = {
              pageName: draft.pageName,
              blocks: draft.blocks,
              rootBlocks: draft.rootBlocks,
              savedAt: draft.savedAt,
            }
          })
        } else {
          // No stale draft - clear any existing draft for this page
          if (draft) {
            await draftStore.deleteDraft(page.name)
          }
          set((state) => {
            state.currentPage = page
            state.currentPageName = date
            state.isLoading = false
          })
        }

        // Record this access in recent sheets
        recordSheetAccess(page)

        // Update browser history
        if (pushHistory) {
          const url = buildUrlPath('journal', date)
          window.history.pushState({ type: 'journal', name: date }, '', url)
        }
      } catch (e) {
        set((state) => {
          state.error = e instanceof Error ? e.message : 'Failed to load journal'
          state.isLoading = false
        })
      }
    },

    initializeFromUrl: async () => {
      try {
        const base = import.meta.env.BASE_URL.replace(/\/$/, '')
        if (window.location.pathname === `${base}/tasks`) {
          set((state) => {
            state.viewingTasks = true
          })
          return
        }
        const { type, name } = parseUrlPath(window.location.pathname)
        if (type && name) {
          if (type === 'journal') {
            await get().navigateToJournal(name, false)
          } else {
            // Both 'page' and 'content-type' use navigateToPage
            // navigateToPage will detect content type paths and route appropriately
            await get().navigateToPage(name, false)
          }
        } else {
          // Default to today's journal
          await get().loadTodaysJournal()
        }
      } finally {
        set((state) => {
          state.initialized = true
        })
      }
    },

    createPage: async (name: string) => {
      try {
        const page = await api.pages.create(name)
        set((state) => {
          state.currentPage = page
          state.currentPageName = name
        })
        // Record this access in recent sheets
        recordSheetAccess(page)
      } catch (e) {
        set((state) => {
          state.error = e instanceof Error ? e.message : 'Failed to create page'
        })
      }
    },

    deletePage: async (name: string) => {
      try {
        // Check if this is a content type path (e.g., "person/John Smith" or "meeting/2026-01-23/Name")
        // by looking for a matching content type directory
        const contentTypes = useSettingsStore.getState().contentTypes
        // Decompose via the shared name authority (custom type if a known
        // directory prefix matches; otherwise a page).
        const parsed = parseName(name, contentTypes)
        const contentType =
          parsed.contentTypeId === 'page'
            ? null
            : contentTypes.find((ct) => ct.id === parsed.contentTypeId) ?? null
        const sheetName = parsed.bareName
        const sheetDate = parsed.date

        // Use sheets API for content type paths, pages API for regular pages
        if (contentType) {
          await api.sheets.delete(contentType.id, sheetName, sheetDate)
        } else {
          await api.pages.delete(name)
        }

        set((state) => {
          if (state.currentPageName === name) {
            state.currentPage = null
            state.currentPageName = null
          }
        })
        // Remove from recent sheets so it doesn't appear in sidebar history
        useRecentSheetsStore.getState().removeSheet(name)
      } catch (e) {
        set((state) => {
          state.error = e instanceof Error ? e.message : 'Failed to delete page'
        })
      }
    },

    updateCurrentPage: async (blocks: Block[], rootBlocksHint?: string[]) => {
      const { currentPage } = get()
      if (!currentPage) return

      // Compute new root blocks
      const blockMap: Record<string, Block> = {}
      const newRootUuids = new Set<string>()

      for (const block of blocks) {
        blockMap[block.uuid] = block
        if (!block.parentUuid) {
          newRootUuids.add(block.uuid)
        }
      }

      let finalRoots: string[]

      if (rootBlocksHint) {
        // Use the hint, but filter to only include valid root UUIDs
        finalRoots = rootBlocksHint.filter(uuid => newRootUuids.has(uuid))
        // Add any roots not in the hint at the end
        for (const uuid of newRootUuids) {
          if (!finalRoots.includes(uuid)) {
            finalRoots.push(uuid)
          }
        }
      } else {
        // Build new rootBlocks list preserving order and inserting new roots smartly
        const existingRoots = currentPage.rootBlocks.filter(uuid => newRootUuids.has(uuid))
        const addedRoots = [...newRootUuids].filter(uuid => !currentPage.rootBlocks.includes(uuid))

        // For each new root, try to insert it after its former parent (if parent is a root)
        finalRoots = [...existingRoots]
        for (const newRootUuid of addedRoots) {
          // Check the old state to find the former parent
          const oldBlock = currentPage.blocks[newRootUuid]
          const formerParentUuid = oldBlock?.parentUuid

          if (formerParentUuid && finalRoots.includes(formerParentUuid)) {
            // Insert after the former parent
            const parentIndex = finalRoots.indexOf(formerParentUuid)
            finalRoots.splice(parentIndex + 1, 0, newRootUuid)
          } else {
            // Append at the end
            finalRoots.push(newRootUuid)
          }
        }
      }

      // Optimistic update (instant, no debounce)
      set((state) => {
        if (state.currentPage) {
          state.currentPage.blocks = blockMap
          state.currentPage.rootBlocks = finalRoots
        }
      })

      // Update sync status to unsaved (single source of truth for unsaved state)
      useSyncStatusStore.getState().setUnsaved()

      // Debounced draft save (faster than server save for data loss prevention)
      if (draftTimeout) {
        clearTimeout(draftTimeout)
      }

      const pageName = currentPage.name
      const serverVersion = currentPage.modifiedAt

      draftTimeout = setTimeout(async () => {
        try {
          await draftStore.saveDraft(pageName, blocks, finalRoots, serverVersion)
        } catch (e) {
          // Draft save failure is not critical - log but don't show error
          console.warn('Failed to save draft to IndexedDB:', e)
        }
      }, DRAFT_DEBOUNCE_MS)

      // Debounced save to server - cancel previous pending save
      if (saveTimeout) {
        clearTimeout(saveTimeout)
      }

      const contentType = currentPage.contentType
      const isJournal = currentPage.isJournal
      const journalDate = currentPage.journalDate

      // Store pending save data for flush on navigation
      pendingSaveData = {
        pageName,
        blocks,
        contentType,
        isJournal,
        journalDate,
      }

      saveTimeout = setTimeout(async () => {
        try {
          // Read version at save time, not call time, to avoid stale version after rapid edits
          const currentState = get()
          const version = currentState.currentPage?.version

          const apiBlocks = blocks.map(api.blockToApiFormat)
          let updatedPage: Page
          const contentTypeObj = useSettingsStore.getState().contentTypes.find(ct => ct.id === contentType)
          if (contentTypeObj) {
            const sheetName = extractSheetName(contentTypeObj, pageName)
            const sheetDate = extractDateFromPageName(contentTypeObj, pageName)
            updatedPage = await api.sheets.update(contentType, sheetName, apiBlocks, version, sheetDate)
          } else {
            // Fallback for unknown content type
            updatedPage = await api.sheets.update(contentType, pageName, apiBlocks, version)
          }
          // Server save succeeded - clear the draft and pending save data
          pendingSaveData = null
          // Record save timestamp to ignore file watcher events for our own save
          lastSaveTimestamp = Date.now()
          await draftStore.deleteDraft(pageName)
          // Log the save activity and update sync status
          useActivityLogStore.getState().addEntry('file_save', pageName)
          useSyncStatusStore.getState().setSaved()
          set((state) => {
            if (state.currentPage && state.currentPage.name === pageName) {
              state.currentPage.version = updatedPage.version
              state.currentPage.modifiedAt = updatedPage.modifiedAt
            }
          })
        } catch (e) {
          if (e instanceof VersionConflictError) {
            // Version conflict - store local changes and prompt user
            set((state) => {
              state.pendingConflict = {
                currentVersion: e.currentVersion,
                localBlocks: blocks,
                localRootBlocks: finalRoots,
              }
            })
          } else {
            set((state) => {
              state.error = e instanceof Error ? e.message : 'Failed to save changes'
            })
          }
        }
      }, SAVE_DEBOUNCE_MS)
    },

    setError: (error) => {
      set((state) => {
        state.error = error
      })
    },

    restoreDraft: () => {
      const { pendingDraftRecovery, currentPage } = get()
      if (!pendingDraftRecovery || !currentPage) return

      // Apply the draft to current page
      const blockMap: Record<string, Block> = {}
      for (const block of pendingDraftRecovery.blocks) {
        blockMap[block.uuid] = block
      }

      set((state) => {
        if (state.currentPage) {
          state.currentPage.blocks = blockMap
          state.currentPage.rootBlocks = pendingDraftRecovery.rootBlocks
          state.pendingDraftRecovery = null
        }
      })

      // Mark as unsaved (will be saved by updateCurrentPage below)
      useSyncStatusStore.getState().setUnsaved()

      // Trigger a save to server
      get().updateCurrentPage(pendingDraftRecovery.blocks)
    },

    discardDraft: async () => {
      const { pendingDraftRecovery } = get()
      if (!pendingDraftRecovery) return

      // Delete the draft from IndexedDB
      await draftStore.deleteDraft(pendingDraftRecovery.pageName)

      set((state) => {
        state.pendingDraftRecovery = null
      })
    },

    resolveConflictKeepMine: async () => {
      const { pendingConflict, currentPage } = get()
      if (!pendingConflict || !currentPage) return

      // Store conflict data locally in case API fails - we need it to restore
      const localConflict = { ...pendingConflict }
      const localPage = { ...currentPage }

      // Clear conflict optimistically
      set((state) => {
        state.pendingConflict = null
      })

      try {
        const apiBlocks = localConflict.localBlocks.map(api.blockToApiFormat)
        let updatedPage: Page
        const contentTypeObj = useSettingsStore.getState().contentTypes.find(ct => ct.id === localPage.contentType)
        if (contentTypeObj) {
          const sheetName = extractSheetName(contentTypeObj, localPage.name)
          const sheetDate = extractDateFromPageName(contentTypeObj, localPage.name)
          updatedPage = await api.sheets.update(localPage.contentType, sheetName, apiBlocks, undefined, sheetDate)
        } else {
          updatedPage = await api.sheets.update(localPage.contentType, localPage.name, apiBlocks)
        }
        // Update local state with new version
        // Record save timestamp to ignore file watcher events
        lastSaveTimestamp = Date.now()
        await draftStore.deleteDraft(localPage.name)
        // Update sync status to saved
        useSyncStatusStore.getState().setSaved()
        set((state) => {
          if (state.currentPage) {
            state.currentPage.version = updatedPage.version
            state.currentPage.modifiedAt = updatedPage.modifiedAt
          }
        })
      } catch (e) {
        // Restore the conflict so user can try again
        set((state) => {
          state.pendingConflict = localConflict
          state.error = e instanceof Error ? e.message : 'Failed to save changes'
        })
      }
    },

    resolveConflictKeepServer: async () => {
      const { pendingConflict, currentPage } = get()
      if (!pendingConflict || !currentPage) return

      // Store for potential restoration
      const localConflict = { ...pendingConflict }
      const localPage = { ...currentPage }

      set((state) => {
        state.pendingConflict = null
      })

      // Reload the page from server
      try {
        if (localPage.isJournal && localPage.journalDate) {
          await get().navigateToJournal(localPage.journalDate, false)
        } else {
          await get().navigateToPage(localPage.name, false)
        }
      } catch (e) {
        // Restore the conflict so user can try again
        set((state) => {
          state.pendingConflict = localConflict
          state.error = e instanceof Error ? e.message : 'Failed to reload page from server'
        })
      }
    },

    dismissConflict: () => {
      set((state) => {
        state.pendingConflict = null
      })
    },

    flushPendingSave: async () => {
      // Cancel the pending debounced save
      if (saveTimeout) {
        clearTimeout(saveTimeout)
        saveTimeout = null
      }

      // If there's pending save data, save it immediately
      if (pendingSaveData) {
        const { pageName, blocks, contentType } = pendingSaveData
        pendingSaveData = null

        try {
          const currentState = get()
          const version = currentState.currentPage?.version

          const apiBlocks = blocks.map(api.blockToApiFormat)
          let updatedPage: Page
          const contentTypeObj = useSettingsStore.getState().contentTypes.find(ct => ct.id === contentType)
          if (contentTypeObj) {
            const sheetName = extractSheetName(contentTypeObj, pageName)
            const sheetDate = extractDateFromPageName(contentTypeObj, pageName)
            updatedPage = await api.sheets.update(contentType, sheetName, apiBlocks, version, sheetDate)
          } else {
            // Fallback for unknown content type
            updatedPage = await api.sheets.update(contentType, pageName, apiBlocks, version)
          }

          // Record save timestamp to ignore file watcher events for our own save
          lastSaveTimestamp = Date.now()
          await draftStore.deleteDraft(pageName)
          // Log the save activity and update sync status
          useActivityLogStore.getState().addEntry('file_save', pageName)
          useSyncStatusStore.getState().setSaved()
          set((state) => {
            if (state.currentPage && state.currentPage.name === pageName) {
              state.currentPage.version = updatedPage.version
              state.currentPage.modifiedAt = updatedPage.modifiedAt
            }
          })
        } catch (e) {
          // On navigation, we don't want to block with conflict dialogs
          // Just log the error - the draft is still saved locally
          console.warn('Failed to flush pending save:', e)
        }
      }
    },

    clearRecentFiles: () => {
      // Clear locally tracked recent sheets
      useRecentSheetsStore.getState().clearAll()
    },

    reset: () => {
      // Cancel any pending debounced operations
      if (saveTimeout) {
        clearTimeout(saveTimeout)
        saveTimeout = null
      }
      if (draftTimeout) {
        clearTimeout(draftTimeout)
        draftTimeout = null
      }
      pendingSaveData = null

      // Reset sync status store
      useSyncStatusStore.getState().reset()

      // Reset all state to initial values
      set((state) => {
        state.currentPage = null
        state.currentPageName = null
        state.isLoading = false
        state.initialized = false
        state.error = null
        state.pendingDraftRecovery = null
        state.pendingConflict = null
        state.editingTemplate = null
        state.editingImportError = null
        state.pendingCursorPosition = null
        state.viewingTasks = false
      })
    },

    updateCurrentPageProperty: async (key: string, value: string | null) => {
      const { currentPage } = get()
      if (!currentPage) return

      // Update the page properties
      const newProperties = { ...currentPage.properties }
      if (value === null) {
        delete newProperties[key]
      } else {
        newProperties[key] = value
      }

      // Update local state immediately
      set((state) => {
        if (state.currentPage) {
          state.currentPage.properties = newProperties
        }
      })

      // Get all current blocks and trigger a save
      // This will serialize properties back to the first block
      const blocks = Object.values(currentPage.blocks)
      await get().updateCurrentPage(blocks)
    },

    // Template editing actions
    openTemplateEditor: async (contentTypeId: string, contentTypeName: string) => {
      set((state) => {
        state.isLoading = true
        state.error = null
      })

      try {
        const page = await api.templates.get(contentTypeId)
        set((state) => {
          state.editingTemplate = {
            contentTypeId,
            contentTypeName,
            page,
            hasUnsavedChanges: false,
          }
          state.isLoading = false
        })
      } catch (e) {
        // If template doesn't exist (404), create an empty page structure
        // The template will be created on first save via PUT
        if (e instanceof Error && e.message.includes('404')) {
          const emptyBlockUuid = crypto.randomUUID()
          const emptyPage: Page = {
            name: `template:${contentTypeId}`,
            title: `${contentTypeName} Template`,
            rootBlocks: [emptyBlockUuid],
            blocks: {
              [emptyBlockUuid]: {
                uuid: emptyBlockUuid,
                content: '',
                parentUuid: null,
                children: [],
                collapsed: false,
                properties: {},
                depth: 0,
              },
            },
            properties: {},
            contentType: 'template',
            isJournal: false,
            journalDate: null,
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
            version: 0,
          }
          set((state) => {
            state.editingTemplate = {
              contentTypeId,
              contentTypeName,
              page: emptyPage,
              hasUnsavedChanges: false,
            }
            state.isLoading = false
          })
          return
        }
        set((state) => {
          state.error = e instanceof Error ? e.message : 'Failed to load template'
          state.isLoading = false
        })
      }
    },

    updateTemplate: (blocks: Block[], rootBlocksHint?: string[]) => {
      const { editingTemplate } = get()
      if (!editingTemplate) return

      // Compute new root blocks
      const blockMap: Record<string, Block> = {}
      const newRootUuids = new Set<string>()

      for (const block of blocks) {
        blockMap[block.uuid] = block
        if (!block.parentUuid) {
          newRootUuids.add(block.uuid)
        }
      }

      let finalRoots: string[]

      if (rootBlocksHint) {
        // Use the hint, but filter to only include valid root UUIDs
        finalRoots = rootBlocksHint.filter(uuid => newRootUuids.has(uuid))
        // Add any roots not in the hint at the end
        for (const uuid of newRootUuids) {
          if (!finalRoots.includes(uuid)) {
            finalRoots.push(uuid)
          }
        }
      } else {
        // Build new rootBlocks list preserving order and inserting new roots smartly
        const existingRoots = editingTemplate.page.rootBlocks.filter(uuid => newRootUuids.has(uuid))
        const addedRoots = [...newRootUuids].filter(uuid => !editingTemplate.page.rootBlocks.includes(uuid))
        finalRoots = [...existingRoots, ...addedRoots]
      }

      // Update template state
      set((state) => {
        if (state.editingTemplate) {
          state.editingTemplate.page.blocks = blockMap
          state.editingTemplate.page.rootBlocks = finalRoots
          state.editingTemplate.hasUnsavedChanges = true
        }
      })
    },

    saveTemplate: async () => {
      const { editingTemplate } = get()
      if (!editingTemplate) return

      try {
        // First, ensure the content type is saved to the server.
        // This prevents 404 errors when creating sheets if the user edited a template
        // for a newly-created content type without saving the content type config first.
        const contentTypes = useSettingsStore.getState().contentTypes
        await api.contentTypes.update(contentTypes)

        const apiBlocks = Object.values(editingTemplate.page.blocks).map(api.blockToApiFormat)
        await api.templates.update(editingTemplate.contentTypeId, apiBlocks)

        set((state) => {
          if (state.editingTemplate) {
            state.editingTemplate.hasUnsavedChanges = false
          }
        })

        useActivityLogStore.getState().addEntry('file_save', `template:${editingTemplate.contentTypeId}`)
      } catch (e) {
        set((state) => {
          state.error = e instanceof Error ? e.message : 'Failed to save template'
        })
      }
    },

    closeTemplateEditor: () => {
      set((state) => {
        state.editingTemplate = null
      })
    },

    consumePendingCursorPosition: () => {
      const { pendingCursorPosition } = get()
      if (pendingCursorPosition) {
        // Clear the pending position after consuming it
        set((state) => {
          state.pendingCursorPosition = null
        })
      }
      return pendingCursorPosition
    },

    setPendingScrollTarget: (uuid: string | null) => {
      set((state) => {
        state.pendingScrollTarget = uuid
      })
    },

    consumePendingScrollTarget: () => {
      const { pendingScrollTarget } = get()
      if (pendingScrollTarget) {
        // Clear the pending target after consuming it
        set((state) => {
          state.pendingScrollTarget = null
        })
      }
      return pendingScrollTarget
    },

    // Import error editing actions
    openImportErrorEditor: async (errorName: string) => {
      set((state) => {
        state.isLoading = true
        state.error = null
      })

      try {
        const errorDetail = await api.importApi.errors.get(errorName)

        // Parse the content into blocks
        // For simplicity, we'll create one block per non-empty line
        const lines = errorDetail.content.split('\n')
        const blocks: Record<string, Block> = {}
        const rootBlocks: string[] = []

        for (const line of lines) {
          const blockUuid = crypto.randomUUID()
          blocks[blockUuid] = {
            uuid: blockUuid,
            content: line,
            parentUuid: null,
            children: [],
            collapsed: false,
            properties: {},
            depth: 0,
          }
          rootBlocks.push(blockUuid)
        }

        // If no content, create an empty block
        if (rootBlocks.length === 0) {
          const blockUuid = crypto.randomUUID()
          blocks[blockUuid] = {
            uuid: blockUuid,
            content: '',
            parentUuid: null,
            children: [],
            collapsed: false,
            properties: {},
            depth: 0,
          }
          rootBlocks.push(blockUuid)
        }

        // Extract suggested filename from original name
        const suggestedFileName = errorDetail.originalName
          .replace(/\.md$/, '')
          .replace(/[^a-zA-Z0-9\-_ ]/g, '-')

        const page: Page = {
          name: `import-error:${errorName}`,
          title: errorDetail.originalName,
          rootBlocks,
          blocks,
          properties: {},
          contentType: 'import-error',
          isJournal: false,
          journalDate: null,
          createdAt: errorDetail.timestamp,
          modifiedAt: errorDetail.timestamp,
          version: 0,
        }

        set((state) => {
          state.editingImportError = {
            errorName,
            originalName: errorDetail.originalName,
            error: errorDetail.error,
            timestamp: errorDetail.timestamp,
            page,
            fileName: suggestedFileName,
            hasUnsavedChanges: false,
          }
          state.isLoading = false
        })
      } catch (e) {
        set((state) => {
          state.error = e instanceof Error ? e.message : 'Failed to load import error'
          state.isLoading = false
        })
      }
    },

    updateImportError: (blocks: Block[], rootBlocksHint?: string[]) => {
      const { editingImportError } = get()
      if (!editingImportError) return

      // Compute new root blocks
      const blockMap: Record<string, Block> = {}
      const newRootUuids = new Set<string>()

      for (const block of blocks) {
        blockMap[block.uuid] = block
        if (!block.parentUuid) {
          newRootUuids.add(block.uuid)
        }
      }

      let finalRoots: string[]

      if (rootBlocksHint) {
        // Use the hint, but filter to only include valid root UUIDs
        finalRoots = rootBlocksHint.filter(uuid => newRootUuids.has(uuid))
        // Add any roots not in the hint at the end
        for (const uuid of newRootUuids) {
          if (!finalRoots.includes(uuid)) {
            finalRoots.push(uuid)
          }
        }
      } else {
        // Build new rootBlocks list preserving order and inserting new roots smartly
        const existingRoots = editingImportError.page.rootBlocks.filter(uuid => newRootUuids.has(uuid))
        const addedRoots = [...newRootUuids].filter(uuid => !editingImportError.page.rootBlocks.includes(uuid))
        finalRoots = [...existingRoots, ...addedRoots]
      }

      // Update import error state
      set((state) => {
        if (state.editingImportError) {
          state.editingImportError.page.blocks = blockMap
          state.editingImportError.page.rootBlocks = finalRoots
          state.editingImportError.hasUnsavedChanges = true
        }
      })
    },

    updateImportErrorFileName: (fileName: string) => {
      set((state) => {
        if (state.editingImportError) {
          state.editingImportError.fileName = fileName
          state.editingImportError.hasUnsavedChanges = true
        }
      })
    },

    saveImportError: async (contentType: string, date?: string) => {
      const { editingImportError } = get()
      if (!editingImportError) return

      try {
        // Serialize blocks back to markdown content with proper indentation for nested blocks
        const serializeBlock = (uuid: string, indent: number): string => {
          const block = editingImportError.page.blocks[uuid]
          if (!block) return ''

          const prefix = '  '.repeat(indent) + (indent > 0 ? '- ' : '')
          const lines = [prefix + block.content]

          // Recursively serialize children
          for (const childUuid of block.children) {
            lines.push(serializeBlock(childUuid, indent + 1))
          }

          return lines.join('\n')
        }

        const content = editingImportError.page.rootBlocks
          .map(uuid => serializeBlock(uuid, 0))
          .join('\n')

        await api.importApi.errors.accept(editingImportError.errorName, {
          contentType,
          date,
          content,
          name: editingImportError.fileName,
        })

        useActivityLogStore.getState().addEntry('file_save', editingImportError.fileName)

        set((state) => {
          state.editingImportError = null
        })

        // Dispatch event to notify sidebar to refresh errors list
        window.dispatchEvent(new CustomEvent('import-errors-changed'))
      } catch (e) {
        set((state) => {
          state.error = e instanceof Error ? e.message : 'Failed to save import error'
        })
      }
    },

    discardImportError: async () => {
      const { editingImportError } = get()
      if (!editingImportError) return

      try {
        await api.importApi.errors.delete(editingImportError.errorName)

        set((state) => {
          state.editingImportError = null
        })

        // Dispatch event to notify sidebar to refresh errors list
        window.dispatchEvent(new CustomEvent('import-errors-changed'))
      } catch (e) {
        set((state) => {
          state.error = e instanceof Error ? e.message : 'Failed to discard import error'
        })
      }
    },

    closeImportErrorEditor: () => {
      set((state) => {
        state.editingImportError = null
      })
    },

    openTaskManager: async () => {
      await get().flushPendingSave()
      set((state) => {
        state.viewingTasks = true
        state.editingTemplate = null
        state.editingImportError = null
      })
      const base = import.meta.env.BASE_URL.replace(/\/$/, '')
      window.history.pushState({ viewingTasks: true }, '', `${base}/tasks`)
    },

    closeTaskManager: () => {
      set((state) => {
        state.viewingTasks = false
      })
      // Symmetric undo of openTaskManager's pushState. popstate handler
      // re-syncs viewingTasks from history state; setting the flag false
      // first ensures the browser back navigates to the prior URL.
      if (window.history.state?.viewingTasks) {
        window.history.back()
      } else {
        // Deep-linked /tasks with no prior entry — push the current page's URL
        // so back/refresh stays consistent.
        const cp = get().currentPage
        const base = import.meta.env.BASE_URL.replace(/\/$/, '')
        if (cp) {
          const url = cp.isJournal && cp.journalDate
            ? `${base}/journal/${cp.journalDate}`
            : `${base}/page/${encodeURIComponent(cp.name)}`
          const historyState = cp.isJournal
            ? { type: 'journal', name: cp.journalDate }
            : { type: 'page', name: cp.name }
          window.history.pushState(historyState, '', url)
        } else {
          // No currentPage — navigate to today's journal.
          get().navigateToJournal(formatDateYMD(new Date()))
        }
      }
    },
  }))
)
