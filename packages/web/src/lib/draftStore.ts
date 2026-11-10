// SPDX-License-Identifier: MIT WITH Commons-Clause
// IndexedDB-based draft storage for data loss prevention.
//
// Two things about drafts that are not obvious from the API below.
//
// **They are scoped to a garden.** The key used to be the page name alone, so
// a draft for "Shopping" in one garden and a draft for "Shopping" in another
// were the same record — which was already wrong for two server gardens, and
// becomes a content leak once a local folder garden can be open. The key now
// carries which backend and which garden the draft belongs to, and a listing
// only ever returns the open garden's own.
//
// **In an encrypted garden they are encrypted.** The block text of an unsaved
// edit is the body of a note; writing it to IndexedDB in the clear would undo
// the point of the garden being encrypted. Drafts are sealed to the garden's
// own X25519 recipient, exactly as its note files are, so what is at rest is no
// more readable than the garden itself — and recovery happens after unlock,
// which is where it belongs anyway, since the user cannot act on a recovered
// draft while the garden is locked.
//
// If an encrypted garden is locked, a draft is **refused** rather than written
// in the clear. Losing an unsaved edit is bad; writing the user's notes to disk
// unencrypted after they asked for encryption is worse.

import type { Block } from '../types'
import { activeBackend } from './backend'

const DB_NAME = 'tend-drafts'
// 3, not 2: a version-2 database may already exist in a browser that ran an
// earlier build of this file, and it would not get the new store without a
// further bump — onupgradeneeded only fires on a version change.
const DB_VERSION = 3
const STORE_NAME = 'drafts_v2'
/** Version 1's store, keyed on pageName alone. Read once, then emptied. */
const LEGACY_STORE = 'drafts'

/** A draft as the rest of the app sees it. */
export interface Draft {
  pageName: string
  blocks: Block[]
  rootBlocks: string[]
  savedAt: number
  /** The page's `modifiedAt` when the draft was taken, to detect conflicts. */
  serverVersion: string
}

/**
 * A draft as stored. Either the blocks are there in the clear (a plain
 * garden), or `sealed` holds them as age ciphertext and nothing else does.
 */
interface StoredDraft {
  /** `${scope}\u0000${pageName}`. */
  key: string
  scope: string
  pageName: string
  savedAt: number
  serverVersion: string
  blocks?: Block[]
  rootBlocks?: string[]
  sealed?: Uint8Array
}

let db: IDBDatabase | null = null

/**
 * Which garden a draft belongs to.
 *
 * `server` covers every server garden: the server's own switch already purges
 * content caches and drafts when the active garden changes, so they cannot
 * collide in practice.
 */
export function draftScope(): string {
  const { kind, gardenId } = activeBackend()
  return kind === 'local' ? `local:${gardenId}` : kind
}

export function draftKey(scope: string, pageName: string): string {
  return `${scope}\u0000${pageName}`
}

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
      // Clear cache if browser closes the connection (idle tab, memory pressure)
      db.onclose = () => {
        db = null
      }
      // Best effort, and never awaited: a draft that cannot be carried across
      // is a draft that stays where it is, not a database that will not open.
      void carryOverLegacyDrafts(db)
      resolve(db)
    }

    // The upgrade does exactly one thing: create the new store. It does not
    // read, move or delete anything.
    //
    // That is deliberate. An exception inside a versionchange transaction
    // aborts it and fails the open, which would leave the drafts database
    // permanently unopenable — no draft saving, no recovery, for everyone,
    // not just whoever had a v1 draft. Carrying old drafts across is worth
    // doing but not worth risking that, so it happens afterwards in an
    // ordinary transaction where a failure is a caught no-op.
    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
    }
  })
}

/**
 * Move version 1's drafts into the scoped store, once.
 *
 * Those drafts can only have come from a server garden — nothing else existed
 * when they were written — so that is the scope they get. The legacy store is
 * emptied afterwards rather than deleted, so this cannot run twice and a
 * downgrade still finds the store it expects.
 *
 * Every failure here is swallowed on purpose. The worst outcome is that an
 * unsaved edit from before the upgrade is not offered back, which is a loss of
 * a recovery prompt, not of anything the user can see. Running this inside the
 * upgrade instead would trade that for the chance of an unopenable database.
 */
async function carryOverLegacyDrafts(database: IDBDatabase): Promise<void> {
  try {
    if (!database.objectStoreNames.contains(LEGACY_STORE)) return

    const tx = database.transaction([LEGACY_STORE, STORE_NAME], 'readwrite')
    const legacy = tx.objectStore(LEGACY_STORE)
    const scoped = tx.objectStore(STORE_NAME)

    const old = await request<Draft[]>(legacy.getAll(), 'read legacy drafts')
    if (!old || old.length === 0) return

    // Existing keys win: a draft written since the upgrade is newer than
    // anything left behind by version 1.
    const taken = new Set(await request<IDBValidKey[]>(scoped.getAllKeys(), 'read keys'))

    for (const draft of old) {
      if (!draft?.pageName) continue
      const key = draftKey('server', draft.pageName)
      if (taken.has(key)) continue
      scoped.put({
        key,
        scope: 'server',
        pageName: draft.pageName,
        savedAt: draft.savedAt,
        serverVersion: draft.serverVersion,
        blocks: draft.blocks,
        rootBlocks: draft.rootBlocks,
      } satisfies StoredDraft)
    }

    legacy.clear()
  } catch {
    // Left where they are. The scoped store is unaffected either way.
  }
}

function request<T>(req: IDBRequest<T>, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(new Error(`Failed to ${what}`))
  })
}

async function objectStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const database = await initDB()
  return database.transaction([STORE_NAME], mode).objectStore(STORE_NAME)
}

// --- encryption --------------------------------------------------------------

/**
 * The garden's own encryption, when the open garden has any.
 *
 * `null` means a plain garden, where drafts are stored as they always were.
 * A thrown `DraftLockedError` means the garden is encrypted and locked, so
 * there is no safe way to store one.
 */
async function gardenCrypto(): Promise<{
  seal: (value: unknown) => Promise<Uint8Array>
  open: <T>(sealed: Uint8Array) => Promise<T>
} | null> {
  if (activeBackend().kind !== 'local') return null

  const { localSession } = await import('./local/localBackend')
  const session = localSession()
  if (!session?.encrypted) return null
  if (!session.identity) throw new DraftLockedError()

  const identity = session.identity
  const { openWith, recipientOf, sealTo } = await import('./local/sealedJson')
  const recipient = await recipientOf(identity)

  return {
    seal: (value) => sealTo(recipient, value),
    open: (sealed) => openWith(identity, sealed),
  }
}

/** The garden is encrypted and locked, so a draft cannot be stored or read. */
export class DraftLockedError extends Error {
  constructor() {
    super('This garden is locked, so drafts cannot be stored or recovered')
    this.name = 'DraftLockedError'
  }
}

/** Turn a stored record back into a draft, decrypting if it is sealed. */
async function unseal(stored: StoredDraft | null | undefined): Promise<Draft | null> {
  if (!stored) return null

  if (!stored.sealed) {
    return {
      pageName: stored.pageName,
      blocks: stored.blocks ?? [],
      rootBlocks: stored.rootBlocks ?? [],
      savedAt: stored.savedAt,
      serverVersion: stored.serverVersion,
    }
  }

  const crypto = await gardenCrypto()
  if (!crypto) throw new DraftLockedError()
  const { blocks, rootBlocks } = await crypto.open<{
    blocks: Block[]
    rootBlocks: string[]
  }>(stored.sealed)
  return {
    pageName: stored.pageName,
    blocks,
    rootBlocks,
    savedAt: stored.savedAt,
    serverVersion: stored.serverVersion,
  }
}

// --- the API -----------------------------------------------------------------

/**
 * Save a draft to IndexedDB.
 *
 * Sealed to the garden's recipient in an encrypted garden, and refused outright
 * if that garden is locked.
 */
export async function saveDraft(
  pageName: string,
  blocks: Block[],
  rootBlocks: string[],
  serverVersion: string
): Promise<void> {
  const scope = draftScope()
  const crypto = await gardenCrypto()
  const store = await objectStore('readwrite')

  const base = {
    key: draftKey(scope, pageName),
    scope,
    pageName,
    savedAt: Date.now(),
    serverVersion,
  }
  const draft: StoredDraft = crypto
    ? { ...base, sealed: await crypto.seal({ blocks, rootBlocks }) }
    : { ...base, blocks, rootBlocks }

  await request(store.put(draft), 'save draft')
}

/** Get the open garden's draft for a page. */
export async function getDraft(pageName: string): Promise<Draft | null> {
  const store = await objectStore('readonly')
  const stored = await request<StoredDraft | undefined>(
    store.get(draftKey(draftScope(), pageName)),
    'get draft'
  )
  return unseal(stored)
}

/** Delete a draft (call after a successful save). */
export async function deleteDraft(pageName: string): Promise<void> {
  const store = await objectStore('readwrite')
  await request(store.delete(draftKey(draftScope(), pageName)), 'delete draft')
}

/**
 * Every draft of the open garden, for the recovery prompt on startup.
 *
 * A draft that cannot be decrypted is left out rather than failing the listing:
 * one unreadable record must not hide the rest.
 */
export async function getAllDrafts(): Promise<Draft[]> {
  const scope = draftScope()
  const store = await objectStore('readonly')
  const all = await request<StoredDraft[]>(store.getAll(), 'get all drafts')

  const out: Draft[] = []
  for (const stored of all ?? []) {
    // A record with no scope predates the rekeying and belongs to a server
    // garden; the upgrade rewrites those, so this is belt and braces.
    if ((stored.scope ?? 'server') !== scope) continue
    try {
      const draft = await unseal(stored)
      if (draft) out.push(draft)
    } catch {
      continue
    }
  }
  return out
}

/**
 * Check if a draft exists and is newer than the server version
 */
export async function hasStaleDraft(
  pageName: string,
  serverModifiedAt: string
): Promise<boolean> {
  try {
    const draft = await getDraft(pageName)
    if (!draft) return false

    // Draft is stale if it was saved for a different server version
    // (meaning the user made changes that weren't saved to the server)
    return draft.serverVersion !== serverModifiedAt
  } catch {
    // A locked garden cannot be asked. Reporting "no stale draft" is right:
    // there is nothing the user can do about it until they unlock.
    return false
  }
}

/** Clear every draft, of every garden. Used on user switch and on reset. */
export async function clearAllDrafts(): Promise<void> {
  const store = await objectStore('readwrite')
  await request(store.clear(), 'clear drafts')
}

/** Clear the open garden's drafts, leaving other gardens' alone. */
export async function clearGardenDrafts(): Promise<void> {
  const scope = draftScope()
  const store = await objectStore('readwrite')
  const all = await request<StoredDraft[]>(store.getAll(), 'clear drafts')
  for (const stored of all ?? []) {
    if ((stored.scope ?? 'server') === scope) store.delete(stored.key)
  }
}

/** Tests only: drop the cached connection so a fresh one is opened. */
export function resetDraftDbForTests(): void {
  db?.close()
  db = null
}
