// SPDX-License-Identifier: MIT WITH Commons-Clause
// IndexedDB-based draft storage for data loss prevention

import type { Block } from '../types'

const DB_NAME = 'tend-drafts'
const DB_VERSION = 1
const STORE_NAME = 'drafts'

interface Draft {
  pageName: string
  blocks: Block[]
  rootBlocks: string[]
  savedAt: number
  serverVersion: string // modifiedAt from server, to detect conflicts
}

let db: IDBDatabase | null = null

/**
 * Initialize the IndexedDB database
 */
async function initDB(): Promise<IDBDatabase> {
  if (db) return db

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      reject(new Error('Failed to open IndexedDB'))
    }

    request.onsuccess = () => {
      db = request.result
      resolve(db)
    }

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result

      // Create the drafts object store with pageName as key
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'pageName' })
      }
    }
  })
}

/**
 * Save a draft to IndexedDB
 */
export async function saveDraft(
  pageName: string,
  blocks: Block[],
  rootBlocks: string[],
  serverVersion: string
): Promise<void> {
  const database = await initDB()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite')
    const store = transaction.objectStore(STORE_NAME)

    const draft: Draft = {
      pageName,
      blocks,
      rootBlocks,
      savedAt: Date.now(),
      serverVersion,
    }

    const request = store.put(draft)

    request.onerror = () => {
      reject(new Error('Failed to save draft'))
    }

    request.onsuccess = () => {
      resolve()
    }
  })
}

/**
 * Get a draft from IndexedDB
 */
export async function getDraft(pageName: string): Promise<Draft | null> {
  const database = await initDB()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.get(pageName)

    request.onerror = () => {
      reject(new Error('Failed to get draft'))
    }

    request.onsuccess = () => {
      resolve(request.result || null)
    }
  })
}

/**
 * Delete a draft from IndexedDB (call after successful server save)
 */
export async function deleteDraft(pageName: string): Promise<void> {
  const database = await initDB()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.delete(pageName)

    request.onerror = () => {
      reject(new Error('Failed to delete draft'))
    }

    request.onsuccess = () => {
      resolve()
    }
  })
}

/**
 * Get all drafts (for showing recovery options on startup)
 */
export async function getAllDrafts(): Promise<Draft[]> {
  const database = await initDB()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.getAll()

    request.onerror = () => {
      reject(new Error('Failed to get all drafts'))
    }

    request.onsuccess = () => {
      resolve(request.result || [])
    }
  })
}

/**
 * Check if a draft exists and is newer than the server version
 */
export async function hasStaleDraft(
  pageName: string,
  serverModifiedAt: string
): Promise<boolean> {
  const draft = await getDraft(pageName)
  if (!draft) return false

  // Draft is stale if it was saved for a different server version
  // (meaning the user made changes that weren't saved to the server)
  return draft.serverVersion !== serverModifiedAt
}

/**
 * Clear all drafts (for testing or reset)
 */
export async function clearAllDrafts(): Promise<void> {
  const database = await initDB()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.clear()

    request.onerror = () => {
      reject(new Error('Failed to clear drafts'))
    }

    request.onsuccess = () => {
      resolve()
    }
  })
}
