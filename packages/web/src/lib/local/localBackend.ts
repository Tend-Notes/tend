// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// The API, served from a folder on this machine.
//
// Same groups `api.ts` exposes for a server garden — pages, journals, sheets,
// templates, content types, search, links, tags, todos, blocks, user state —
// answered from the open folder instead of from HTTP. The dispatcher in
// `api.ts` picks between them per garden.
//
// # Shape
//
//   - A **session** is the open garden (its store, and its identity while
//     unlocked). Exactly one is open at a time, set by the garden switch.
//   - Every read goes through a **scan** of the folder, cached until something
//     is written. `gardenIndex` explains why a rescan rather than a patch.
//   - A sheet's identity is (content type, bare name, date). `pages` and
//     `journals` are the built-in types' sheets, so they delegate rather than
//     having a second implementation.
//
// What is deliberately absent: git, import, gardens, identity, reindex. A
// local garden has no server-side repo, no server to import into, and no
// server-held index to rebuild. The dispatcher fails closed on a missing
// method, so absence here is a refusal, never a fall-through to the server.

import type {
  BacklinkRef,
  BlockRef,
  BlockUpdate,
  BlockUpdateResult,
  CreateSheetResponse,
  CursorPosition,
  Graph,
  Page,
  PageMeta,
} from '../../types'
import {
  VersionConflictError,
  type BlockData,
  type ContentType,
  type SearchResponse,
  type SearchStatus,
  type StabilizeResponse,
  type TagInfo,
  type TaskList,
  type WikilinkTargetsResponse,
} from '../api'
import { loadWasm } from '../wasm'
import { StaleWriteError } from './LocalFolderStore'
import {
  BUILT_IN_CONTENT_TYPES,
  deleteSheet,
  filedUnder,
  findContentType,
  qualifiedName,
  readContentTypes,
  readGardenJson,
  readSheet,
  readTemplate,
  writeContentTypes,
  writeGardenJson,
  writeSheet,
  writeTemplate,
  type GardenSession,
} from './gardenFiles'
import { backlinksOf, buildIndex, searchIndex, type GardenIndex } from './gardenIndex'

/** No garden is open, so there is nothing to read. */
export class NoLocalGardenError extends Error {
  constructor() {
    super('No local garden is open')
    this.name = 'NoLocalGardenError'
  }
}

// --- the open garden ---------------------------------------------------------

let session: GardenSession | null = null
let cachedTypes: ContentType[] | null = null
let cachedIndex: Promise<GardenIndex> | null = null

/**
 * Canonical name -> the file's mtime when its content was last handed out.
 *
 * This is the staleness baseline, and it deliberately does not move when the
 * folder is rescanned: it records what the *user* was last shown. A save checks
 * against it, so an edit made by another program after the app read the file is
 * refused rather than overwritten. Our own writes update it; the folder watcher
 * drops an entry when it sees an outside change, so the user is given the newer
 * content instead of a conflict they cannot clear.
 */
const servedAt = new Map<string, number>()

/**
 * Open a garden, or close the current one with `null`.
 *
 * Called by the garden switch and by unlock. Everything derived from the
 * previous garden is dropped here, which is what makes a switch — and a lock —
 * leave no decrypted content behind.
 */
export function setLocalSession(next: GardenSession | null): void {
  session = next
  cachedTypes = null
  cachedIndex = null
  servedAt.clear()
}

/** The open garden. Exported for the flows that need the store directly. */
export function localSession(): GardenSession | null {
  return session
}

function current(): GardenSession {
  if (!session) throw new NoLocalGardenError()
  return session
}

/**
 * Forget the scan, so the next read rebuilds it.
 *
 * Called after every write, and by the folder watcher when something changes
 * underneath us.
 */
export function invalidateLocalIndex(): void {
  cachedIndex = null
}

/**
 * Forget what a sheet was last served as, because the folder changed outside
 * Tend. The next read picks up the new content; the next save checks against
 * that rather than refusing forever.
 */
export function forgetServedSheet(canonicalName?: string): void {
  if (canonicalName === undefined) servedAt.clear()
  else servedAt.delete(canonicalName)
}

async function types(): Promise<ContentType[]> {
  if (!cachedTypes) cachedTypes = await readContentTypes(current())
  return cachedTypes
}

/**
 * The scanned garden.
 *
 * The promise is cached, not the result, so simultaneous readers share one
 * scan instead of each starting their own.
 */
async function index(): Promise<GardenIndex> {
  if (!cachedIndex) {
    const scanning = buildIndex(current(), await types())
    cachedIndex = scanning
    // A failed scan must not be cached, or one transient read error disables
    // the garden for the session.
    scanning.catch(() => {
      if (cachedIndex === scanning) cachedIndex = null
    })
  }
  return cachedIndex
}

async function typeById(id: string): Promise<ContentType> {
  return findContentType(await types(), id)
}

// --- sheets ------------------------------------------------------------------

/**
 * Turn a stale-write refusal into the conflict the app already handles.
 *
 * On the server this is a 409 from a version check; here it is a changed mtime,
 * which means another program edited the file. Different cause, same question
 * for the user, same dialog.
 */
function asConflict(e: unknown, version: number): never {
  if (e instanceof StaleWriteError) {
    throw new VersionConflictError(
      'This sheet changed on disk since it was opened',
      version
    )
  }
  throw e
}

/**
 * An empty page of this type, for a sheet that does not exist yet.
 *
 * The canonical name, title, journal flag and date all come from the bridge —
 * a journal's date is its filename, which is not something to work out here.
 */
async function emptySheet(
  contentType: ContentType,
  name: string,
  date?: string
): Promise<Page> {
  const wasm = await loadWasm()
  const meta = JSON.parse(
    wasm.sheet_meta(
      JSON.stringify(contentType),
      name,
      filedUnder(contentType, date),
      0,
      0n,
      0n
    )
  ) as PageMeta
  const page = JSON.parse(wasm.parse_markdown('', meta.name)) as Page
  page.name = meta.name
  page.title = meta.title
  page.contentType = meta.contentType
  page.isJournal = meta.isJournal
  page.journalDate = meta.journalDate
  return page
}

/**
 * The baseline a save checks against: the page as last served, and the mtime it
 * had then.
 *
 * Reads the recorded mtime rather than re-reading the file, because a fresh
 * read would return the value we are about to write over and so could never
 * disagree.
 */
async function lastSeen(
  contentType: ContentType,
  name: string,
  date?: string
): Promise<{ page: Page; lastModified: number } | null> {
  const canonical = await qualifiedName(contentType, name, date)
  const scanned = (await index()).sheets.get(canonical)
  if (!scanned) return null
  return { page: scanned.page, lastModified: servedAt.get(canonical) ?? scanned.lastModified }
}

async function getSheet(
  contentTypeId: string,
  name: string,
  date?: string
): Promise<Page> {
  const contentType = await typeById(contentTypeId)
  const loaded = await readSheet(current(), contentType, name, date)
  if (!loaded) throw new Error(`Sheet '${name}' not found`)
  // The user has now been shown this version; a later save checks against it.
  servedAt.set(loaded.page.name, loaded.lastModified)
  return loaded.page
}

async function updateSheet(
  contentTypeId: string,
  name: string,
  blocks: BlockData[],
  version?: number,
  date?: string,
  properties?: Record<string, string | null>
): Promise<Page> {
  const contentType = await typeById(contentTypeId)
  const existing = await lastSeen(contentType, name, date)
  const wasm = await loadWasm()

  // A sheet the editor saved before it existed on disk is a create, which is
  // how the server's PUT behaves too.
  const base = existing?.page ?? (await emptySheet(contentType, name, date))

  let page = JSON.parse(
    wasm.apply_block_updates(
      JSON.stringify(base),
      JSON.stringify(blocks),
      version === undefined ? undefined : BigInt(version)
    )
  ) as Page
  if (properties) {
    page = JSON.parse(
      wasm.apply_property_updates(JSON.stringify(page), JSON.stringify(properties))
    ) as Page
  }

  try {
    const written = await writeSheet(
      current(),
      contentType,
      page,
      date,
      existing?.lastModified
    )
    servedAt.set(page.name, written)
  } catch (e) {
    asConflict(e, base.version)
  }
  invalidateLocalIndex()
  return page
}

async function createSheet(
  contentTypeId: string,
  name: string,
  options?: { date?: string; content?: string }
): Promise<CreateSheetResponse> {
  const contentType = await typeById(contentTypeId)
  const garden = current()
  const wasm = await loadWasm()
  const date = options?.date

  if (contentType.organization === 'namespaced' && !name.includes('/')) {
    throw new Error('A Compilation entry needs a namespace, e.g. "MyBook/Chapter 14"')
  }
  if (await readSheet(garden, contentType, name, date)) {
    throw new Error(`Sheet '${name}' already exists in content type '${contentTypeId}'`)
  }

  let page = await emptySheet(contentType, name, date)
  // The display name as typed, which for a namespaced entry keeps its
  // compilation ("Acme/Chapter 14") — the same form a listing derives.
  page.title = name

  let cursorPosition: CursorPosition | undefined

  // Same order the server applies: explicit content, then a template file, then
  // the type's configured template string.
  if (options?.content !== undefined) {
    const { content, offset } = JSON.parse(
      wasm.strip_cursor_marker(options.content, true)
    ) as { content: string; offset: number | null }
    const block = newBlock(content)
    page.rootBlocks = [block.uuid]
    page.blocks = { [block.uuid]: block }
    if (offset !== null) cursorPosition = { blockUuid: block.uuid, offset }
  } else {
    const template = await readTemplate(garden, contentTypeId)
    if (template) {
      const templatePage = JSON.parse(
        wasm.parse_markdown(template.text, contentTypeId)
      ) as Page
      const result = JSON.parse(
        wasm.instantiate_template(JSON.stringify(templatePage), JSON.stringify(page))
      ) as { page: Page; cursorPosition: CursorPosition | null }
      page = result.page
      cursorPosition = result.cursorPosition ?? undefined
    } else if (contentType.template) {
      const { content, offset } = JSON.parse(
        wasm.strip_cursor_marker(contentType.template, true)
      ) as { content: string; offset: number | null }
      const block = newBlock(content)
      page.rootBlocks = [block.uuid]
      page.blocks = { [block.uuid]: block }
      if (offset !== null) cursorPosition = { blockUuid: block.uuid, offset }
    }
  }

  servedAt.set(page.name, await writeSheet(garden, contentType, page, date))
  invalidateLocalIndex()
  return { ...page, cursorPosition }
}

function newBlock(content: string) {
  return {
    uuid: crypto.randomUUID(),
    content,
    parentUuid: null,
    children: [] as string[],
    collapsed: false,
    properties: {} as Record<string, string>,
    depth: 0,
  }
}

/**
 * The "About" dust jacket that gives a compilation a presence on disk before it
 * has any entries. Body text matches the server's so neither side treats the
 * other's stub as edited.
 */
function defaultAboutBody(compilation: string): string {
  return (
    `This page was created automatically with the "${compilation}" compilation. ` +
    'Use it to keep track of information about the project — a summary, a table of ' +
    'contents, anything — or just throw it away.'
  )
}

// --- the groups --------------------------------------------------------------

export const pages = {
  list: async (): Promise<PageMeta[]> => (await index()).listings.get('page') ?? [],
  get: (name: string) => getSheet('page', name),
  create: (name: string, content?: string) =>
    createSheet('page', name, { content }).then(({ cursorPosition: _, ...page }) => page as Page),
  update: (name: string, blocks: BlockData[], version?: number) =>
    updateSheet('page', name, blocks, version),
  delete: async (name: string): Promise<{ deleted: string }> => {
    await deleteSheet(current(), await typeById('page'), name)
    invalidateLocalIndex()
    return { deleted: name }
  },
  getBacklinks: async (name: string): Promise<BacklinkRef[]> =>
    backlinksOf(await index(), name),
}

export const journals = {
  list: async (): Promise<PageMeta[]> => (await index()).listings.get('journal') ?? [],
  get: (date: string) => getSheet('journal', date),
  update: (date: string, blocks: BlockData[], version?: number) =>
    updateSheet('journal', date, blocks, version),
}

export const sheets = {
  list: async (contentTypeId: string): Promise<PageMeta[]> => {
    // Look the type up first, so an unknown id is refused rather than
    // answered with an empty list — the server's 404.
    const contentType = await typeById(contentTypeId)
    return (await index()).listings.get(contentType.id) ?? []
  },
  get: (contentTypeId: string, name: string, date?: string) =>
    getSheet(contentTypeId, name, date),
  create: createSheet,
  createCompilation: async (
    contentTypeId: string,
    namespace: string
  ): Promise<{ namespace: string; about_path: string; existed: boolean }> => {
    const contentType = await typeById(contentTypeId)
    if (contentType.organization !== 'namespaced') {
      throw new Error('Only namespaced content types have compilations')
    }
    const trimmed = namespace.trim()
    if (!trimmed || trimmed.includes('/')) {
      throw new Error("A compilation name cannot be empty or contain '/'")
    }
    const wasm = await loadWasm()
    wasm.validate_safe_name(trimmed)

    const name = `${trimmed}/About`
    const aboutPath = await qualifiedName(contentType, name)
    if (await readSheet(current(), contentType, name)) {
      return { namespace: trimmed, about_path: aboutPath, existed: true }
    }

    await createSheet(contentTypeId, name, { content: defaultAboutBody(trimmed) })
    return { namespace: trimmed, about_path: aboutPath, existed: false }
  },
  update: updateSheet,
  delete: async (
    contentTypeId: string,
    name: string,
    date?: string
  ): Promise<{ deleted: string; contentType: string }> => {
    await deleteSheet(current(), await typeById(contentTypeId), name, date)
    invalidateLocalIndex()
    return { deleted: name, contentType: contentTypeId }
  },
}

export const contentTypes = {
  list: (): Promise<ContentType[]> => types(),
  update: async (next: ContentType[]): Promise<ContentType[]> => {
    await writeContentTypes(current(), next)
    cachedTypes = null
    invalidateLocalIndex()
    return types()
  },
}

export const templates = {
  get: async (contentTypeId: string): Promise<Page> => {
    const template = await readTemplate(current(), contentTypeId)
    const wasm = await loadWasm()
    return JSON.parse(wasm.parse_markdown(template?.text ?? '', contentTypeId)) as Page
  },
  update: async (contentTypeId: string, blocks: BlockData[]): Promise<Page> => {
    const wasm = await loadWasm()
    const base = JSON.parse(wasm.parse_markdown('', contentTypeId)) as Page
    const page = JSON.parse(
      wasm.apply_block_updates(JSON.stringify(base), JSON.stringify(blocks), undefined)
    ) as Page
    await writeTemplate(current(), contentTypeId, wasm.serialize_page(JSON.stringify(page)))
    return page
  },
}

export const search = {
  query: async (q: string, limit = 20): Promise<SearchResponse> => {
    const scanned = await index()
    return { results: searchIndex(scanned, q, limit), status: await search.status() }
  },
  /**
   * The index is built from the folder on first search and dropped on lock, so
   * it is always "ready" while a garden is open and never on disk. `encrypted`
   * drives the lock badge's explanation, which already covers exactly this.
   */
  status: async (): Promise<SearchStatus> => ({
    indexStatus: 'ready',
    numDocs: (await index()).sheets.size,
    encrypted: current().encrypted,
    indexOnDisk: false,
    message: 'Searching this folder from memory',
  }),
}

export const links = {
  getWikilinkTargets: async (): Promise<WikilinkTargetsResponse> => ({
    targets: (await index()).wikilinkTargets,
  }),
}

export const graph = {
  get: async (): Promise<Graph> => (await index()).graph,
}

export const tags = {
  list: async (): Promise<TagInfo[]> => (await index()).tags,
}

export const todos = {
  list: async (): Promise<TaskList> => ({ tasks: (await index()).tasks }),
}

export const blocks = {
  lookup: async (uuid: string): Promise<BlockRef | null> => {
    for (const sheet of (await index()).sheets.values()) {
      const block = sheet.page.blocks[uuid]
      if (block) {
        return {
          uuid,
          pageName: sheet.page.name,
          content: block.content,
          hasChildren: block.children.length > 0,
        }
      }
    }
    return null
  },

  /**
   * Edit one block wherever it lives — what the task manager does to a task it
   * is showing off-page.
   */
  update: async (uuid: string, patch: BlockUpdate): Promise<BlockUpdateResult> => {
    const scanned = await index()
    const sheet = patch.pageName
      ? scanned.sheets.get(patch.pageName)
      : [...scanned.sheets.values()].find((s) => s.page.blocks[uuid])
    if (!sheet?.page.blocks[uuid]) throw new Error(`Block ${uuid} not found`)

    const page: Page = JSON.parse(JSON.stringify(sheet.page))
    const block = page.blocks[uuid]
    if (patch.content !== undefined) block.content = patch.content
    for (const [key, value] of Object.entries(patch.properties ?? {})) {
      if (value === null) delete block.properties[key]
      else block.properties[key] = value
    }

    page.version += 1
    try {
      const written = await writeSheet(
        current(),
        sheet.contentType,
        page,
        sheet.ref.date,
        servedAt.get(page.name) ?? sheet.lastModified
      )
      servedAt.set(page.name, written)
    } catch (e) {
      asConflict(e, sheet.page.version)
    }
    invalidateLocalIndex()

    return {
      uuid,
      pageName: page.name,
      content: block.content,
      properties: block.properties,
      version: page.version,
    }
  },
}

/**
 * Preferences and UI state, kept in the garden folder.
 *
 * On the server these are per *user* and shared across their gardens. For a
 * local garden they live in `.tend/` instead, encrypted with the garden when it
 * is encrypted, because the recents and tag lists ARE note titles. That is also
 * why the server-side UI-state sync is suspended while a local garden is open
 * rather than filtered: the server's blob is per user, and a reduced payload
 * would wipe the server garden's own recents.
 */
export const user = {
  getPrefs: async (): Promise<Record<string, unknown>> =>
    (await readGardenJson<Record<string, unknown>>(current(), 'prefs')) ?? {},
  savePrefs: async (prefs: Record<string, unknown>): Promise<void> => {
    await writeGardenJson(current(), 'prefs', prefs)
  },
  getState: async (): Promise<Record<string, unknown>> =>
    (await readGardenJson<Record<string, unknown>>(current(), 'ui-state')) ?? {},
  saveState: async (state: Record<string, unknown>): Promise<void> => {
    await writeGardenJson(current(), 'ui-state', state)
  },
}

/**
 * Give every block a stable UUID in the file, so block references survive.
 *
 * Client-side here: it reads and rewrites every sheet through the same
 * serializer the server uses, which writes the block footer. A sheet that
 * already has one is left untouched.
 */
export const stabilize = {
  stabilizeUuids: async (): Promise<StabilizeResponse> => {
    const garden = current()
    const wasm = await loadWasm()
    let stabilized = 0
    let alreadyStable = 0
    let failed = 0

    for (const sheet of (await index()).sheets.values()) {
      const raw = await readSheet(garden, sheet.contentType, sheet.ref.name, sheet.ref.date)
      if (!raw) {
        failed += 1
        continue
      }
      // Already stable when rewriting it would change nothing. Compared as
      // text, not bytes, so this works for an encrypted garden too — where the
      // ciphertext differs on every write even when the content does not.
      if (wasm.serialize_page(JSON.stringify(raw.page)) === raw.text) {
        alreadyStable += 1
        continue
      }
      try {
        await writeSheet(garden, sheet.contentType, raw.page, sheet.ref.date, raw.lastModified)
        stabilized += 1
      } catch {
        failed += 1
      }
    }

    invalidateLocalIndex()
    return {
      stabilized,
      alreadyStable,
      failed,
      message: `Stabilized ${stabilized} sheet${stabilized === 1 ? '' : 's'} in this folder`,
    }
  },
}

/** Tests only. */
export function resetLocalBackendForTests(): void {
  setLocalSession(null)
}

export { BUILT_IN_CONTENT_TYPES }
