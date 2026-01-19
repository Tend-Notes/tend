// SPDX-License-Identifier: MIT WITH Commons-Clause
// Page and navigation state management

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Page, PageMeta, Block } from '../types'
import * as api from '../lib/api'

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
}

// Helper to build URL path for content
function buildUrlPath(type: 'page' | 'journal', name: string): string {
  return `/${type}/${encodeURIComponent(name)}`
}

// Helper to parse URL path into type and name
function parseUrlPath(path: string): { type: 'page' | 'journal' | null; name: string | null } {
  const match = path.match(/^\/(page|journal)\/(.+)$/)
  if (match) {
    return { type: match[1] as 'page' | 'journal', name: decodeURIComponent(match[2]) }
  }
  return { type: null, name: null }
}

// Debounce helper for server saves
let saveTimeout: ReturnType<typeof setTimeout> | null = null
const SAVE_DEBOUNCE_MS = 500

export const usePageStore = create<PageState>()(
  immer((set, get) => ({
    currentPage: null,
    currentPageName: null,
    pages: [],
    journals: [],
    isLoading: false,
    error: null,

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
      })

      try {
        const page = await api.journals.getToday()
        set((state) => {
          state.currentPage = page
          state.currentPageName = page.name
          state.isLoading = false
        })
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
      set((state) => {
        state.isLoading = true
        state.error = null
      })

      try {
        const page = await api.pages.get(name)
        set((state) => {
          state.currentPage = page
          state.currentPageName = name
          state.isLoading = false
        })
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
      set((state) => {
        state.isLoading = true
        state.error = null
      })

      try {
        const page = await api.journals.get(date)
        set((state) => {
          state.currentPage = page
          state.currentPageName = date
          state.isLoading = false
        })
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

      // Optimistic update (instant, no debounce)
      set((state) => {
        if (state.currentPage) {
          const blockMap: Record<string, Block> = {}
          const newRootUuids = new Set<string>()

          for (const block of blocks) {
            blockMap[block.uuid] = block
            if (!block.parentUuid) {
              newRootUuids.add(block.uuid)
            }
          }

          // Build new rootBlocks list preserving order and inserting new roots smartly
          const existingRoots = state.currentPage.rootBlocks.filter(uuid => newRootUuids.has(uuid))
          const addedRoots = [...newRootUuids].filter(uuid => !state.currentPage!.rootBlocks.includes(uuid))

          // For each new root, try to insert it after its former parent (if parent is a root)
          let finalRoots = [...existingRoots]
          for (const newRootUuid of addedRoots) {
            // Check the old state to find the former parent
            const oldBlock = state.currentPage.blocks[newRootUuid]
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

          state.currentPage.blocks = blockMap
          state.currentPage.rootBlocks = finalRoots
        }
      })

      // Debounced save to server - cancel previous pending save
      if (saveTimeout) {
        clearTimeout(saveTimeout)
      }

      // Capture current page info for the closure
      const pageName = currentPage.name
      const isJournal = currentPage.isJournal
      const journalDate = currentPage.journalDate

      saveTimeout = setTimeout(async () => {
        try {
          const apiBlocks = blocks.map(api.blockToApiFormat)
          if (isJournal && journalDate) {
            await api.journals.update(journalDate, apiBlocks)
          } else {
            await api.pages.update(pageName, apiBlocks)
          }
        } catch (e) {
          set((state) => {
            state.error = e instanceof Error ? e.message : 'Failed to save changes'
          })
        }
      }, SAVE_DEBOUNCE_MS)
    },

    setError: (error) => {
      set((state) => {
        state.error = error
      })
    },
  }))
)
