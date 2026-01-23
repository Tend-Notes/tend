// SPDX-License-Identifier: MIT WITH Commons-Clause
// Page and navigation state management

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Page, Block } from '../types'
import * as api from '../lib/api'
import { VersionConflictError } from '../lib/api'
import * as draftStore from '../lib/draftStore'
import { useActivityLogStore } from './activityLogStore'
import { useSyncStatusStore } from './syncStatusStore'
import { useSettingsStore } from './settingsStore'
import { useRecentSheetsStore } from './recentSheetsStore'

interface PageState {
  // Current page/journal being viewed
  currentPage: Page | null
  currentPageName: string | null

  // Loading states
  isLoading: boolean
  error: string | null

  // Draft state
  hasUnsavedChanges: boolean
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
  if (type === 'content-type') {
    // Content types go directly at root: /person/John%20Smith
    return `/${encodedSegments.join('/')}`
  }
  return `/${type}/${encodedSegments.join('/')}`
}

// Helper to parse URL path into type and name
// Decodes each path segment separately to preserve directory structure
//
// Returns:
// - { type: 'journal', name: 'YYYY-MM-DD' } for /journal/YYYY-MM-DD
// - { type: 'page', name: 'pagename' } for /page/pagename
// - { type: 'content-type', name: 'person/John Smith' } for /person/John%20Smith
function parseUrlPath(path: string): { type: 'page' | 'journal' | 'content-type' | null; name: string | null } {
  // Check for journal or page prefix first
  const match = path.match(/^\/(page|journal)\/(.+)$/)
  if (match) {
    const decodedSegments = match[2].split('/').map(segment => decodeURIComponent(segment))
    return { type: match[1] as 'page' | 'journal', name: decodedSegments.join('/') }
  }

  // Check for content type paths (e.g., /person/John%20Smith or /meeting/2026-01-23/Name)
  // These are at root level with format: /directory/... (remaining path)
  const contentTypeMatch = path.match(/^\/([^/]+)\/(.+)$/)
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
    error: null,
    hasUnsavedChanges: false,
    pendingDraftRecovery: null,
    pendingConflict: null,

    loadTodaysJournal: async () => {
      set((state) => {
        state.isLoading = true
        state.error = null
        state.hasUnsavedChanges = false
        state.pendingDraftRecovery = null
      })

      try {
        const page = await api.journals.getToday()

        // Check for stale draft
        const draft = await draftStore.getDraft(page.name)
        if (draft && draft.serverVersion !== page.modifiedAt) {
          // Found a draft that differs from server - offer recovery
          set((state) => {
            state.currentPage = page
            state.currentPageName = page.name
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
            state.currentPageName = page.name
            state.isLoading = false
          })
        }

        // Record this access in recent sheets
        recordSheetAccess(page)

        // Update URL without adding to history (initial load)
        const url = buildUrlPath('journal', page.journalDate || page.name)
        window.history.replaceState({ type: 'journal', name: page.journalDate || page.name }, '', url)
      } catch (e) {
        set((state) => {
          state.error = e instanceof Error ? e.message : 'Failed to load today\'s journal'
          state.isLoading = false
        })
      }
    },

    navigateToPage: async (name: string, pushHistory = true) => {
      // Flush any pending saves before navigating away
      await get().flushPendingSave()

      set((state) => {
        state.isLoading = true
        state.error = null
        state.hasUnsavedChanges = false
        state.pendingDraftRecovery = null
      })

      // Check if this is a content type path (e.g., "person/John Smith" or "meeting/2026-01-23/Name")
      // by looking for a matching content type directory
      const contentTypes = useSettingsStore.getState().contentTypes
      const slashIndex = name.indexOf('/')
      let contentType = null
      let sheetName = name
      let sheetDate: string | undefined

      if (slashIndex > 0) {
        const possibleDir = name.slice(0, slashIndex)
        contentType = contentTypes.find(ct => ct.directory === possibleDir && ct.id !== 'page' && ct.id !== 'journal')
        if (contentType) {
          const remainder = name.slice(slashIndex + 1)
          // For saveByDate content types, the path may be: directory/YYYY-MM-DD/name
          if (contentType.saveByDate) {
            const dateMatch = remainder.match(/^(\d{4}-\d{2}-\d{2})\/(.+)$/)
            if (dateMatch) {
              sheetDate = dateMatch[1]
              sheetName = dateMatch[2]
            } else {
              // No date in path - use remainder as name
              sheetName = remainder
            }
          } else {
            sheetName = remainder
          }
        }
      }

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
            const newPage = contentType
              ? await api.sheets.create(contentType.id, sheetName, { date: sheetDate })
              : await api.pages.create(name)
            set((state) => {
              state.currentPage = newPage
              state.currentPageName = name
              state.isLoading = false
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

      set((state) => {
        state.isLoading = true
        state.error = null
        state.hasUnsavedChanges = false
        state.pendingDraftRecovery = null
      })

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
        await api.pages.delete(name)
        set((state) => {
          if (state.currentPageName === name) {
            state.currentPage = null
            state.currentPageName = null
          }
        })
        // Note: The deleted page will naturally fall out of recent sheets
        // as the user navigates to other pages. No need to explicitly remove.
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
          state.hasUnsavedChanges = true
        }
      })

      // Update sync status to unsaved
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
          if (contentType === 'journal' && journalDate) {
            updatedPage = await api.journals.update(journalDate, apiBlocks, version)
          } else if (contentType === 'page') {
            updatedPage = await api.pages.update(pageName, apiBlocks, version)
          } else {
            // Custom content type - use sheets API
            updatedPage = await api.sheets.update(contentType, pageName, apiBlocks, version, journalDate || undefined)
          }
          // Server save succeeded - clear the draft and pending save data
          pendingSaveData = null
          await draftStore.deleteDraft(pageName)
          // Log the save activity and update sync status
          useActivityLogStore.getState().addEntry('file_save', pageName)
          useSyncStatusStore.getState().setSaved()
          set((state) => {
            state.hasUnsavedChanges = false
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
          state.hasUnsavedChanges = true
        }
      })

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

      // Force save our local changes (without version check)
      set((state) => {
        state.pendingConflict = null
      })

      try {
        const apiBlocks = pendingConflict.localBlocks.map(api.blockToApiFormat)
        let updatedPage: Page
        if (currentPage.isJournal && currentPage.journalDate) {
          // Don't send version - force overwrite
          updatedPage = await api.journals.update(currentPage.journalDate, apiBlocks)
        } else {
          updatedPage = await api.pages.update(currentPage.name, apiBlocks)
        }
        // Update local state with new version
        await draftStore.deleteDraft(currentPage.name)
        set((state) => {
          state.hasUnsavedChanges = false
          if (state.currentPage) {
            state.currentPage.version = updatedPage.version
            state.currentPage.modifiedAt = updatedPage.modifiedAt
          }
        })
      } catch (e) {
        set((state) => {
          state.error = e instanceof Error ? e.message : 'Failed to save changes'
        })
      }
    },

    resolveConflictKeepServer: async () => {
      const { pendingConflict, currentPage } = get()
      if (!pendingConflict || !currentPage) return

      set((state) => {
        state.pendingConflict = null
      })

      // Reload the page from server
      if (currentPage.isJournal && currentPage.journalDate) {
        await get().navigateToJournal(currentPage.journalDate, false)
      } else {
        await get().navigateToPage(currentPage.name, false)
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
        const { pageName, blocks, contentType, journalDate } = pendingSaveData
        pendingSaveData = null

        try {
          const currentState = get()
          const version = currentState.currentPage?.version

          const apiBlocks = blocks.map(api.blockToApiFormat)
          let updatedPage: Page
          if (contentType === 'journal' && journalDate) {
            updatedPage = await api.journals.update(journalDate, apiBlocks, version)
          } else if (contentType === 'page') {
            updatedPage = await api.pages.update(pageName, apiBlocks, version)
          } else {
            // Custom content type - use sheets API
            updatedPage = await api.sheets.update(contentType, pageName, apiBlocks, version, journalDate || undefined)
          }

          await draftStore.deleteDraft(pageName)
          // Log the save activity and update sync status
          useActivityLogStore.getState().addEntry('file_save', pageName)
          useSyncStatusStore.getState().setSaved()
          set((state) => {
            state.hasUnsavedChanges = false
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
  }))
)
