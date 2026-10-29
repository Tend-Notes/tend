// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Sheets as files: the seam between a garden folder and a Page.
//
// `LocalFolderStore` deals in paths and bytes and knows nothing about Tend's
// format. The backend above deals in Pages and knows nothing about files. This
// is the layer between them, and the only one that holds both an encryption
// identity and a path.
//
// # Concepts
//
//   - **session** — an open garden: its store, whether it is encrypted, and
//     (while unlocked) the X25519 identity. Nothing here is persisted; the
//     identity lives in memory for the session and goes on lock.
//   - **bare name** — what the user typed: "Shopping", or "MyBook/Chapter 14"
//     for a namespaced type. Not the qualified page name.
//   - **qualified name** — what a Page carries in `name`, and what links and
//     indices key on. Derived by the bridge, never assembled here.
//
// Every rule about where a file goes, what it is called and what its metadata
// says comes from the wasm bridge, which is the server's own code. This module
// decides none of it; it only walks directories and moves bytes.

import type { Page } from '../../types'
import { GardenLockedError, type ContentType } from '../api'
import { loadWasm, type TendWasm } from '../wasm'
import { LocalFolderStore, StaleWriteError } from './LocalFolderStore'

/** An open local garden. */
export interface GardenSession {
  readonly id: string
  readonly store: LocalFolderStore
  readonly encrypted: boolean
  /**
   * The garden's X25519 identity, present only while an encrypted garden is
   * unlocked. In memory only — never written, never sent anywhere.
   */
  identity?: string
}

/** Where a garden's own configuration lives, inside the folder. */
const CONTENT_TYPES_PATH = '.tend/content-types.json'
const TEMPLATE_DIR = '.tend/templates'

/**
 * The built-in types, when a folder has no `content-types.json`.
 *
 * Same ids, directories and organizations the server's defaults use, so a
 * garden created here opens unchanged when the server is pointed at it.
 */
export const BUILT_IN_CONTENT_TYPES: ContentType[] = [
  { id: 'page', name: 'Page', directory: 'pages', organization: 'flat', template: '' },
  { id: 'journal', name: 'Journal', directory: 'journals', organization: 'dateNamed', template: '' },
]

/** The garden is encrypted and has not been unlocked this session. */
function requireIdentity(session: GardenSession): string {
  if (!session.identity) throw new GardenLockedError(session.id, 'This garden is locked')
  return session.identity
}

/** Today, as the bridge wants it. Only a date-foldered type needs one. */
export function filedUnder(
  contentType: ContentType,
  date?: string | null
): string | undefined {
  if (date) return date
  if (contentType.organization !== 'dateFoldered') return undefined
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// --- paths -------------------------------------------------------------------

function joinSegments(wasm: TendWasm, args: Parameters<TendWasm['sheet_rel_path']>): string {
  return (JSON.parse(wasm.sheet_rel_path(...args)) as string[]).join('/')
}

/**
 * The path a sheet is written to: percent-encoded leaf, and the garden's
 * extension.
 */
export async function sheetPath(
  session: GardenSession,
  contentType: ContentType,
  name: string,
  date?: string | null
): Promise<string> {
  const wasm = await loadWasm()
  return joinSegments(wasm, [
    JSON.stringify(contentType),
    name,
    filedUnder(contentType, date),
    session.encrypted,
    true,
  ])
}

/**
 * The path a sheet is actually at: the encoded one when it exists, else the
 * legacy un-encoded one, else null.
 *
 * Gardens written before filename encoding existed still have the raw form, and
 * the server reads both; so must this.
 */
export async function existingSheetPath(
  session: GardenSession,
  contentType: ContentType,
  name: string,
  date?: string | null
): Promise<string | null> {
  const wasm = await loadWasm()
  const resolved = filedUnder(contentType, date)
  for (const encode of [true, false]) {
    const path = joinSegments(wasm, [
      JSON.stringify(contentType),
      name,
      resolved,
      session.encrypted,
      encode,
    ])
    if (await session.store.exists(path)) return path
  }
  return null
}

// --- bytes <-> text ----------------------------------------------------------

/**
 * A sheet file's text. Decrypts in an encrypted garden, which is also where a
 * locked garden is refused.
 */
async function readFileText(
  session: GardenSession,
  path: string
): Promise<{ text: string; lastModified: number } | null> {
  if (!session.encrypted) return session.store.readText(path)

  const identity = requireIdentity(session)
  const result = await session.store.read(path)
  if (!result) return null

  const wasm = await loadWasm()
  return {
    text: wasm.decrypt_with_identity(result.bytes, identity),
    lastModified: result.lastModified,
  }
}

/** Write a sheet file, encrypting to the garden's recipient when required. */
async function writeFileText(
  session: GardenSession,
  path: string,
  text: string,
  expectedLastModified?: number
): Promise<number> {
  if (!session.encrypted) {
    return session.store.write(path, text, { expectedLastModified })
  }

  const identity = requireIdentity(session)
  const wasm = await loadWasm()
  const recipient = wasm.identity_to_recipient(identity)
  return session.store.write(path, wasm.encrypt_to_recipient(text, recipient), {
    expectedLastModified,
  })
}

// --- content types -----------------------------------------------------------

/**
 * A garden's content types, from `.tend/content-types.json`.
 *
 * A folder with no such file is a garden with just pages and journals, which is
 * what the server assumes too. A malformed file falls back to the built-ins
 * rather than leaving the garden unopenable — the worst case is that a custom
 * type's sheets are not listed until the file is fixed, and nothing is lost.
 */
export async function readContentTypes(session: GardenSession): Promise<ContentType[]> {
  // Deliberately NOT encrypted: the server reads this file as plain JSON, and
  // it holds no note content — only type names and directories.
  const file = await session.store.readText(CONTENT_TYPES_PATH)
  if (!file) return BUILT_IN_CONTENT_TYPES

  try {
    const parsed = JSON.parse(file.text) as unknown
    const list = Array.isArray(parsed)
      ? parsed
      : (parsed as { contentTypes?: unknown; content_types?: unknown }).contentTypes ??
        (parsed as { content_types?: unknown }).content_types
    if (!Array.isArray(list) || list.length === 0) return BUILT_IN_CONTENT_TYPES
    return list as ContentType[]
  } catch {
    return BUILT_IN_CONTENT_TYPES
  }
}

export async function writeContentTypes(
  session: GardenSession,
  types: ContentType[]
): Promise<void> {
  await session.store.write(CONTENT_TYPES_PATH, JSON.stringify(types, null, 2))
}

export function findContentType(types: ContentType[], id: string): ContentType {
  const found = types.find((t) => t.id === id)
  if (!found) throw new Error(`Content type '${id}' not found`)
  return found
}

// --- sheets ------------------------------------------------------------------

/** A sheet on disk, before it is read: name, date and the file it is in. */
export interface SheetRef {
  name: string
  date: string | null
  path: string
}

/**
 * Every sheet of a content type, from filenames alone.
 *
 * Nothing is read or decrypted, so this is as cheap for an encrypted garden as
 * for a plain one. Which files count, and what each one's name and date are, is
 * the bridge's decision.
 */
export async function listSheetRefs(
  session: GardenSession,
  contentType: ContentType
): Promise<SheetRef[]> {
  const wasm = await loadWasm()
  const paths = await session.store.listFiles(contentType.directory)
  const refs: SheetRef[] = []

  for (const relative of paths) {
    const parts = relative.split('/')
    const filename = parts.pop() as string
    const found = JSON.parse(
      wasm.sheet_ref(JSON.stringify(contentType), JSON.stringify(parts), filename, session.encrypted)
    ) as { name: string; date: string | null } | null
    if (found) {
      refs.push({ ...found, path: `${contentType.directory}/${relative}` })
    }
  }
  return refs
}

/**
 * The canonical page name for a bare name — the form links and indices use.
 *
 * Not the path, and not simply the directory plus the name: a built-in flat
 * type's canonical name is the bare name with no prefix at all, while a custom
 * type's is directory-prefixed. The bridge decides, because getting this wrong
 * silently breaks every backlink.
 */
export async function qualifiedName(
  contentType: ContentType,
  name: string,
  date?: string | null
): Promise<string> {
  const wasm = await loadWasm()
  return wasm.qualify_name(JSON.stringify(contentType), name, filedUnder(contentType, date))
}

/** The bare name and date behind a canonical name. The inverse of the above. */
export async function splitName(
  contentType: ContentType,
  canonical: string
): Promise<{ name: string; date: string | null }> {
  const wasm = await loadWasm()
  return JSON.parse(wasm.split_name(JSON.stringify(contentType), canonical)) as {
    name: string
    date: string | null
  }
}

/** A sheet read and parsed, with the mtime its next write will check. */
export interface LoadedSheet {
  page: Page
  lastModified: number
  path: string
}

/** Read one sheet, or null when there is no such file. */
export async function readSheet(
  session: GardenSession,
  contentType: ContentType,
  name: string,
  date?: string | null
): Promise<LoadedSheet | null> {
  const path = await existingSheetPath(session, contentType, name, date)
  if (!path) return null
  return readSheetAt(session, contentType, name, date, path)
}

/**
 * Read a sheet whose file is already known.
 *
 * The parse needs the qualified name because the file does not carry it, and
 * the content type and date because a Page records both.
 */
export async function readSheetAt(
  session: GardenSession,
  contentType: ContentType,
  name: string,
  date: string | null | undefined,
  path: string
): Promise<LoadedSheet | null> {
  const file = await readFileText(session, path)
  if (!file) return null

  const wasm = await loadWasm()
  const qualified = await qualifiedName(contentType, name, date)
  const page = JSON.parse(wasm.parse_markdown(file.text, qualified)) as Page

  // The parser works out the block tree; the content type and date come from
  // where the file sits, which only the caller knows.
  const resolved = filedUnder(contentType, date) ?? null
  page.contentType = contentType.id
  page.isJournal = contentType.id === 'journal'
  page.journalDate = page.isJournal || contentType.organization === 'dateFoldered' ? resolved : null

  return { page, lastModified: file.lastModified, path }
}

/**
 * Write a sheet. Returns the new mtime, which the caller keeps for its next
 * write.
 *
 * `expectedLastModified` is how an edit by another program is caught: the write
 * is refused with `StaleWriteError` rather than clobbering it.
 */
export async function writeSheet(
  session: GardenSession,
  contentType: ContentType,
  page: Page,
  date?: string | null,
  expectedLastModified?: number
): Promise<number> {
  const wasm = await loadWasm()
  const text = wasm.serialize_page(JSON.stringify(page))

  // Write back to the file the sheet is already in, so a legacy un-encoded name
  // is updated in place rather than shadowed by an encoded twin.
  const bare = await bareName(contentType, page)
  const path =
    (await existingSheetPath(session, contentType, bare, date)) ??
    (await sheetPath(session, contentType, bare, date))

  return writeFileText(session, path, text, expectedLastModified)
}

/**
 * The bare name of a page of this type, recovered from the canonical name a
 * Page carries — which is what `sheetPath` wants.
 */
async function bareName(
  contentType: ContentType,
  page: Page
): Promise<string> {
  return (await splitName(contentType, page.name)).name
}

/** Delete a sheet's file. Missing is success. */
export async function deleteSheet(
  session: GardenSession,
  contentType: ContentType,
  name: string,
  date?: string | null
): Promise<void> {
  const path = await existingSheetPath(session, contentType, name, date)
  if (path) await session.store.delete(path)
}

// --- templates ---------------------------------------------------------------

/**
 * A content type's template file, or null.
 *
 * Templates are note content, so in an encrypted garden they are encrypted
 * like any other file — which is also how the server writes them.
 */
export async function readTemplate(
  session: GardenSession,
  contentTypeId: string
): Promise<{ text: string; lastModified: number } | null> {
  return readFileText(session, templatePath(session, contentTypeId))
}

export async function writeTemplate(
  session: GardenSession,
  contentTypeId: string,
  text: string
): Promise<void> {
  await writeFileText(session, templatePath(session, contentTypeId), text)
}

function templatePath(session: GardenSession, contentTypeId: string): string {
  return `${TEMPLATE_DIR}/${contentTypeId}.md${session.encrypted ? '.age' : ''}`
}

// --- per-garden JSON ---------------------------------------------------------

/**
 * Read a JSON file from `.tend/`, encrypted in an encrypted garden.
 *
 * This is how the UI state (recents, tag list) travels with the folder instead
 * of going to the server — see the plan's *Per-garden UI state*. The `.age`
 * suffix is applied for an encrypted garden because these names ARE note
 * titles.
 */
export async function readGardenJson<T>(session: GardenSession, name: string): Promise<T | null> {
  const file = await readFileText(session, gardenJsonPath(session, name))
  if (!file) return null
  try {
    return JSON.parse(file.text) as T
  } catch {
    // A corrupt UI-state file must not stop a garden from opening.
    return null
  }
}

export async function writeGardenJson(
  session: GardenSession,
  name: string,
  value: unknown
): Promise<void> {
  await writeFileText(session, gardenJsonPath(session, name), JSON.stringify(value))
}

function gardenJsonPath(session: GardenSession, name: string): string {
  return `.tend/${name}.json${session.encrypted ? '.age' : ''}`
}

export { StaleWriteError }
