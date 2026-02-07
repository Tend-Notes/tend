// SPDX-License-Identifier: MIT WITH Commons-Clause
// IndexedDB-based storage for demo mode (no backend required)

import type { Page, PageMeta } from '../types'

const DB_NAME = 'tend-demo'
const DB_VERSION = 2

// Object store names
const STORES = {
  PAGES: 'pages',
  JOURNALS: 'journals',
  META: 'meta',
  PREFS: 'prefs',
  STATE: 'state',
} as const

// Meta keys
const META_KEYS = {
  LAST_ACTIVITY: 'lastActivity',
  EXPIRY_HOURS: 'expiryHours',
  INITIALIZED: 'initialized',
  CONTENT_VERSION: 'contentVersion',
} as const

// Default expiry hours (6 hours of inactivity)
const DEFAULT_EXPIRY_HOURS = 6
const MIN_EXPIRY_HOURS = 3
const MAX_EXPIRY_HOURS = 24

let db: IDBDatabase | null = null

/**
 * Initialize the IndexedDB database for demo mode
 */
export async function initDemoDb(): Promise<IDBDatabase> {
  if (db) return db

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      reject(new Error('Failed to open demo IndexedDB'))
    }

    request.onsuccess = () => {
      db = request.result
      // Clear cache if browser closes the connection (idle tab, memory pressure)
      db.onclose = () => {
        db = null
      }
      resolve(db)
    }

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result

      // Create object stores if they don't exist
      if (!database.objectStoreNames.contains(STORES.PAGES)) {
        database.createObjectStore(STORES.PAGES, { keyPath: 'name' })
      }
      if (!database.objectStoreNames.contains(STORES.JOURNALS)) {
        database.createObjectStore(STORES.JOURNALS, { keyPath: 'journalDate' })
      }
      if (!database.objectStoreNames.contains(STORES.META)) {
        database.createObjectStore(STORES.META)
      }
      if (!database.objectStoreNames.contains(STORES.PREFS)) {
        database.createObjectStore(STORES.PREFS)
      }
      if (!database.objectStoreNames.contains(STORES.STATE)) {
        database.createObjectStore(STORES.STATE)
      }
    }
  })
}

// ============================================================================
// Generic store operations
// ============================================================================

async function getFromStore<T>(storeName: string, key: string): Promise<T | null> {
  const database = await initDemoDb()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([storeName], 'readonly')
    const store = transaction.objectStore(storeName)
    const request = store.get(key)

    request.onerror = () => reject(new Error(`Failed to get ${key} from ${storeName}`))
    request.onsuccess = () => resolve(request.result || null)
  })
}

async function putInStore<T>(storeName: string, value: T, key?: string): Promise<void> {
  const database = await initDemoDb()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([storeName], 'readwrite')
    const store = transaction.objectStore(storeName)
    const request = key ? store.put(value, key) : store.put(value)

    request.onerror = () => reject(new Error(`Failed to put in ${storeName}`))
    request.onsuccess = () => resolve()
  })
}

async function deleteFromStore(storeName: string, key: string): Promise<void> {
  const database = await initDemoDb()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([storeName], 'readwrite')
    const store = transaction.objectStore(storeName)
    const request = store.delete(key)

    request.onerror = () => reject(new Error(`Failed to delete ${key} from ${storeName}`))
    request.onsuccess = () => resolve()
  })
}

async function getAllFromStore<T>(storeName: string): Promise<T[]> {
  const database = await initDemoDb()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([storeName], 'readonly')
    const store = transaction.objectStore(storeName)
    const request = store.getAll()

    request.onerror = () => reject(new Error(`Failed to get all from ${storeName}`))
    request.onsuccess = () => resolve(request.result || [])
  })
}

async function clearStore(storeName: string): Promise<void> {
  const database = await initDemoDb()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([storeName], 'readwrite')
    const store = transaction.objectStore(storeName)
    const request = store.clear()

    request.onerror = () => reject(new Error(`Failed to clear ${storeName}`))
    request.onsuccess = () => resolve()
  })
}

// ============================================================================
// Pages API
// ============================================================================

export async function getPage(name: string): Promise<Page | null> {
  await updateLastActivity()
  return getFromStore<Page>(STORES.PAGES, name)
}

export async function savePage(page: Page): Promise<void> {
  await updateLastActivity()
  return putInStore(STORES.PAGES, page)
}

export async function deletePage(name: string): Promise<void> {
  await updateLastActivity()
  return deleteFromStore(STORES.PAGES, name)
}

export async function listPages(): Promise<PageMeta[]> {
  await updateLastActivity()
  const pages = await getAllFromStore<Page>(STORES.PAGES)
  return pages.map(pageToMeta)
}

// ============================================================================
// Journals API
// ============================================================================

export async function getJournal(date: string): Promise<Page | null> {
  await updateLastActivity()
  return getFromStore<Page>(STORES.JOURNALS, date)
}

export async function saveJournal(page: Page): Promise<void> {
  await updateLastActivity()
  // Use journalDate as the key
  return putInStore(STORES.JOURNALS, page)
}

export async function deleteJournal(date: string): Promise<void> {
  await updateLastActivity()
  return deleteFromStore(STORES.JOURNALS, date)
}

export async function listJournals(): Promise<PageMeta[]> {
  await updateLastActivity()
  const journals = await getAllFromStore<Page>(STORES.JOURNALS)
  return journals.map(pageToMeta)
}

// ============================================================================
// Meta API (activity tracking, expiry)
// ============================================================================

export async function updateLastActivity(): Promise<void> {
  await putInStore(STORES.META, Date.now(), META_KEYS.LAST_ACTIVITY)
}

export async function getLastActivity(): Promise<number | null> {
  return getFromStore<number>(STORES.META, META_KEYS.LAST_ACTIVITY)
}

export async function getExpiryHours(): Promise<number> {
  const hours = await getFromStore<number>(STORES.META, META_KEYS.EXPIRY_HOURS)
  return hours ?? DEFAULT_EXPIRY_HOURS
}

export async function setExpiryHours(hours: number): Promise<void> {
  const clamped = Math.max(MIN_EXPIRY_HOURS, Math.min(MAX_EXPIRY_HOURS, hours))
  await putInStore(STORES.META, clamped, META_KEYS.EXPIRY_HOURS)
}

export async function isInitialized(): Promise<boolean> {
  const init = await getFromStore<boolean>(STORES.META, META_KEYS.INITIALIZED)
  return init === true
}

export async function setInitialized(value: boolean): Promise<void> {
  await putInStore(STORES.META, value, META_KEYS.INITIALIZED)
}

export async function getContentVersion(): Promise<number> {
  const version = await getFromStore<number>(STORES.META, META_KEYS.CONTENT_VERSION)
  return version ?? 0
}

export async function setContentVersion(version: number): Promise<void> {
  await putInStore(STORES.META, version, META_KEYS.CONTENT_VERSION)
}

/**
 * Check if the demo session has expired due to inactivity
 */
export async function checkExpiry(): Promise<boolean> {
  const lastActivity = await getLastActivity()
  if (!lastActivity) {
    // No activity recorded yet, not expired
    return false
  }

  const expiryHours = await getExpiryHours()
  const expiryMs = expiryHours * 60 * 60 * 1000
  const now = Date.now()

  return now - lastActivity > expiryMs
}

/**
 * Clear all demo data and reset to initial state
 */
export async function clearAll(): Promise<void> {
  await clearStore(STORES.PAGES)
  await clearStore(STORES.JOURNALS)
  await clearStore(STORES.META)
  // Keep prefs and state - user settings should persist across sessions
}

/**
 * Full reset including preferences
 */
export async function fullReset(): Promise<void> {
  await clearStore(STORES.PAGES)
  await clearStore(STORES.JOURNALS)
  await clearStore(STORES.META)
  await clearStore(STORES.PREFS)
  await clearStore(STORES.STATE)
}

// ============================================================================
// Preferences API
// ============================================================================

export async function getPrefs(): Promise<Record<string, unknown>> {
  const prefs = await getFromStore<Record<string, unknown>>(STORES.PREFS, 'prefs')
  return prefs ?? {}
}

export async function savePrefs(prefs: Record<string, unknown>): Promise<void> {
  await putInStore(STORES.PREFS, prefs, 'prefs')
}

// ============================================================================
// State API
// ============================================================================

export async function getState(): Promise<Record<string, unknown>> {
  const state = await getFromStore<Record<string, unknown>>(STORES.STATE, 'state')
  return state ?? {}
}

export async function saveState(state: Record<string, unknown>): Promise<void> {
  await putInStore(STORES.STATE, state, 'state')
}

// ============================================================================
// Utilities
// ============================================================================

function pageToMeta(page: Page): PageMeta {
  return {
    name: page.name,
    title: page.title,
    contentType: page.contentType,
    isJournal: page.isJournal,
    journalDate: page.journalDate,
    blockCount: Object.keys(page.blocks).length,
    createdAt: page.createdAt,
    modifiedAt: page.modifiedAt,
  }
}

/**
 * Get all pages and journals combined (for search/links computation)
 */
export async function getAllSheets(): Promise<Page[]> {
  const [pages, journals] = await Promise.all([
    getAllFromStore<Page>(STORES.PAGES),
    getAllFromStore<Page>(STORES.JOURNALS),
  ])
  return [...pages, ...journals]
}

/**
 * Find a block by UUID across all pages and journals
 */
export async function findBlockByUuid(uuid: string): Promise<{ page: Page; block: import('../types').Block } | null> {
  const sheets = await getAllSheets()
  for (const page of sheets) {
    const block = page.blocks[uuid]
    if (block) {
      return { page, block }
    }
  }
  return null
}

// Export constants for use elsewhere
export { DEFAULT_EXPIRY_HOURS, MIN_EXPIRY_HOURS, MAX_EXPIRY_HOURS }
