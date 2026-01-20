// SPDX-License-Identifier: MIT WITH Commons-Clause
// Page and navigation state management

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Page, PageMeta, Block } from '../types'
import * as api from '../lib/api'
import { VersionConflictError } from '../lib/api'
import * as draftStore from '../lib/draftStore'
import { useActivityLogStore } from './activityLogStore'
import { useSyncStatusStore } from './syncStatusStore'

interface PageState {
  // Current page/journal being viewed
  currentPage: Page | null
  currentPageName: string | null

  // Page list for sidebar
  pages: PageMeta[]
  journals: PageMeta[]

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
  loadPages: () => Promise<void>
  loadJournals: () => Promise<void>
  loadTodaysJournal: () => Promise<void>
  navigateToPage: (name: string, pushHistory?: boolean) => Promise<void>
  navigateToJournal: (date: string, pushHistory?: boolean) => Promise<void>
  createPage: (name: string) => Promise<void>
  deletePage: (name: string) => Promise<void>
  updateCurrentPage: (blocks: Block[]) => Promise<void>
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
}

// Helper to build URL path for content
// Encodes each path segment separately to preserve directory structure
function buildUrlPath(type: 'page' | 'journal', name: string): string {
  const encodedSegments = name.split('/').map(segment => encodeURIComponent(segment))
  return `/${type}/${encodedSegments.join('/')}`
}

// Helper to parse URL path into type and name
// Decodes each path segment separately to preserve directory structure
function parseUrlPath(path: string): { type: 'page' | 'journal' | null; name: string | null } {
  const match = path.match(/^\/(page|journal)\/(.+)$/)
  if (match) {
    const decodedSegments = match[2].split('/').map(segment => decodeURIComponent(segment))
    return { type: match[1] as 'page' | 'journal', name: decodedSegments.join('/') }
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
  isJournal: boolean
  journalDate: string | null
} | null = null

export const usePageStore = create<PageState>()(
  immer((set, get) => ({
    currentPage: null,
    currentPageName: null,
    pages: [],
    journals: [],
    isLoading: false,
    error: null,
    hasUnsavedChanges: false,
    pendingDraftRecovery: null,
    pendingConflict: null,

    loadPages: async () => {
      try {
        const pages = await api.pages.list()
        set((state) => {
          state.pages = pages
        })
      } catch (e) {
        set((state) => {
          state.error = e instanceof Error ? e.message : 'Failed to load pages'
        })
      }
    },

    loadJournals: async () => {
      try {
        const journals = await api.journals.list()
        set((state) => {
          state.journals = journals
        })
      } catch (e) {
        set((state) => {
          state.error = e instanceof Error ? e.message : 'Failed to load journals'
        })
      }
    },

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

        // Update URL without adding to history (initial load)
        const url = buildUrlPath('journal', page.journalDate || page.name)
        window.history.replaceState({ type: 'journal', name: page.journalDate || page.name }, '', url)
        // Refresh journals list
        get().loadJournals()
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

      try {
        const page = await api.pages.get(name)

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

        // Update browser history
        if (pushHistory) {
          const url = buildUrlPath('page', name)
          window.history.pushState({ type: 'page', name }, '', url)
        }
      } catch (e) {
        // If page doesn't exist (404), create it
        if (e instanceof Error && e.message.includes('404')) {
          try {
            const newPage = await api.pages.create(name)
            set((state) => {
              state.currentPage = newPage
              state.currentPageName = name
              state.isLoading = false
            })
            // Update browser history
            if (pushHistory) {
              const url = buildUrlPath('page', name)
              window.history.pushState({ type: 'page', name }, '', url)
            }
            // Refresh pages list
            get().loadPages()
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
        // Refresh pages list
        get().loadPages()
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
        // Refresh pages list
        get().loadPages()
      } catch (e) {
        set((state) => {
          state.error = e instanceof Error ? e.message : 'Failed to delete page'
        })
      }
    },

    updateCurrentPage: async (blocks: Block[]) => {
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

      // Build new rootBlocks list preserving order and inserting new roots smartly
      const existingRoots = currentPage.rootBlocks.filter(uuid => newRootUuids.has(uuid))
      const addedRoots = [...newRootUuids].filter(uuid => !currentPage.rootBlocks.includes(uuid))

      // For each new root, try to insert it after its former parent (if parent is a root)
      let finalRoots = [...existingRoots]
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

      const isJournal = currentPage.isJournal
      const journalDate = currentPage.journalDate

      // Store pending save data for flush on navigation
      pendingSaveData = {
        pageName,
        blocks,
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
          if (isJournal && journalDate) {
            updatedPage = await api.journals.update(journalDate, apiBlocks, version)
          } else {
            updatedPage = await api.pages.update(pageName, apiBlocks, version)
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
        const { pageName, blocks, isJournal, journalDate } = pendingSaveData
        pendingSaveData = null

        try {
          const currentState = get()
          const version = currentState.currentPage?.version

          const apiBlocks = blocks.map(api.blockToApiFormat)
          let updatedPage: Page
          if (isJournal && journalDate) {
            updatedPage = await api.journals.update(journalDate, apiBlocks, version)
          } else {
            updatedPage = await api.pages.update(pageName, apiBlocks, version)
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
  }))
)
