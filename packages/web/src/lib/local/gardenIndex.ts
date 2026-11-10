// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Everything the server derives from a garden, derived in the browser instead.
//
// A server garden has five indices behind it — search, links, blocks, tags,
// todos — each kept up to date as pages are written. A local garden has no
// server to ask, and no index on disk either: writing one would put note
// content in the clear next to an encrypted garden, which is the thing this
// feature exists to avoid.
//
// So the whole lot is derived from one pass over the folder, held in memory,
// and dropped on lock or garden switch. That is the same posture an encrypted
// server garden already has, and the garden-lock badge already explains it.
//
// # Concepts
//
//   - **scan** — read and parse every sheet once. Everything below is a view
//     over the result, so a page is parsed once rather than once per index.
//   - **canonical name** — what a page's `name` holds and what links match on.
//   - **normalized name** — the canonical name folded for matching. The bridge
//     supplies it, since the link index hashes exactly this form.
//
// Interpretation stays in the bridge: which blocks are tasks, which words are
// tags, what a link points at. What is here is the bookkeeping — the maps and
// counts the server keeps in a HashMap and this keeps in a Map.

import type {
  BacklinkRef,
  Graph,
  GraphEdge,
  GraphNode,
  Page,
  PageMeta,
  SearchResult,
} from '../../types'
import type { ContentType, TagInfo, TaskItem } from '../api'
import { loadWasm } from '../wasm'
import {
  filedUnder,
  listSheetRefs,
  readSheetAt,
  type GardenSession,
  type SheetRef,
} from './gardenFiles'

/** A link out of a page, as the bridge reports it. */
interface LinkRef {
  target: string
  normalized: string
  kind: 'wikiLink' | 'tag'
  pageName: string
  blockUuid: string
}

/** A tag occurrence, as the bridge reports it. */
interface TagRef {
  tag: string
  pageName: string
  blockUuid: string
}

/** One sheet, read and parsed, with where it came from. */
export interface IndexedSheet {
  page: Page
  meta: PageMeta
  contentType: ContentType
  ref: SheetRef
  /**
   * The file's mtime when it was scanned — what the app is showing. A save
   * checks against this, so an edit by another program since is caught.
   */
  lastModified: number
}

/**
 * The whole garden, interpreted.
 *
 * Built by [`buildIndex`] and treated as immutable: a write invalidates it
 * rather than patching it. A garden is small enough that a full rescan is
 * cheaper than keeping five maps correct under edits, and it cannot drift.
 */
export interface GardenIndex {
  /** Canonical name -> sheet. */
  readonly sheets: Map<string, IndexedSheet>
  /** Content type id -> its sheets' metadata, in listing order. */
  readonly listings: Map<string, PageMeta[]>
  /** Tag name (folded) -> how many blocks mention it. */
  readonly tags: TagInfo[]
  readonly tasks: TaskItem[]
  /** Normalized target -> the blocks that link to it. */
  readonly backlinks: Map<string, BacklinkRef[]>
  /** Every wiki-link target written anywhere, including pages not yet created. */
  readonly wikilinkTargets: string[]
  readonly graph: Graph
}

/**
 * Read and interpret the whole garden.
 *
 * One pass: every sheet is read, decrypted and parsed exactly once, and every
 * derived view is built from that. A sheet that cannot be read or parsed is
 * skipped rather than failing the scan — one corrupt file must not make a
 * garden unopenable.
 */
export async function buildIndex(
  session: GardenSession,
  contentTypes: ContentType[]
): Promise<GardenIndex> {
  const wasm = await loadWasm()
  const sheets = new Map<string, IndexedSheet>()
  const listings = new Map<string, PageMeta[]>()
  const tagCounts = new Map<string, number>()
  const tasks: TaskItem[] = []
  const links: LinkRef[] = []

  for (const contentType of contentTypes) {
    const refs = await listSheetRefs(session, contentType)
    const metas: PageMeta[] = []

    for (const ref of refs) {
      let loaded
      try {
        loaded = await readSheetAt(session, contentType, ref.name, ref.date, ref.path)
      } catch {
        // Unreadable or undecryptable. Skipped, not fatal.
        continue
      }
      if (!loaded) continue

      sheets.set(loaded.page.name, {
        page: loaded.page,
        meta: loaded.meta,
        contentType,
        ref,
        lastModified: loaded.lastModified,
      })
      metas.push(loaded.meta)

      const pageJson = JSON.stringify(loaded.page)
      for (const tag of JSON.parse(wasm.extract_tags(pageJson)) as TagRef[]) {
        tagCounts.set(tag.tag, (tagCounts.get(tag.tag) ?? 0) + 1)
      }
      tasks.push(
        ...(JSON.parse(
          wasm.extract_tasks(pageJson, JSON.stringify(contentType), filedUnder(contentType, ref.date))
        ) as TaskItem[])
      )
      links.push(...(JSON.parse(wasm.extract_links(pageJson)) as LinkRef[]))
    }

    listings.set(
      contentType.id,
      JSON.parse(wasm.sort_sheets(JSON.stringify(metas), JSON.stringify(contentType))) as PageMeta[]
    )
  }

  return {
    sheets,
    listings,
    tags: [...tagCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    tasks,
    backlinks: buildBacklinks(links, sheets),
    wikilinkTargets: [...new Set(links.filter((l) => l.kind === 'wikiLink').map((l) => l.target))],
    graph: buildGraph(links, sheets, contentTypes),
  }
}

/**
 * Which blocks link to each target.
 *
 * Keyed on the folded target name, because a link matches its target
 * case-insensitively — `[[my page]]` reaches `My Page`. Tags are included: a
 * tag page's backlinks are the blocks that mention the tag, which is how the
 * server answers `/pages/tags%2Fwork/backlinks`.
 */
function buildBacklinks(
  links: LinkRef[],
  sheets: Map<string, IndexedSheet>
): Map<string, BacklinkRef[]> {
  const out = new Map<string, BacklinkRef[]>()

  for (const link of links) {
    const source = sheets.get(link.pageName)
    // A link from a page that is no longer there has no block to show.
    if (!source) continue
    const block = source.page.blocks[link.blockUuid]
    if (!block) continue

    const refs = out.get(link.normalized) ?? []
    refs.push({
      pageName: source.page.name,
      pageTitle: source.meta.title,
      blockUuid: link.blockUuid,
      blockContent: block.content,
      isJournal: source.page.isJournal,
      journalDate: source.page.journalDate,
    })
    out.set(link.normalized, refs)
  }
  return out
}

/**
 * The link graph: a node per sheet, an edge per wiki-link between two sheets
 * that both exist.
 *
 * Only wiki-links, and only to pages that exist — the same two rules the
 * server's `/graph` applies, so the picture matches.
 */
function buildGraph(
  links: LinkRef[],
  sheets: Map<string, IndexedSheet>,
  contentTypes: ContentType[]
): Graph {
  const nodes: GraphNode[] = []
  const used = new Set<string>()
  // Canonical names, folded, so a link's target resolves case-insensitively.
  const byNormalized = new Map<string, string>()

  for (const sheet of sheets.values()) {
    nodes.push({
      id: sheet.page.name,
      label: sheet.meta.title,
      contentType: sheet.contentType.id,
      blockCount: sheet.meta.blockCount,
    })
    used.add(sheet.contentType.id)
    byNormalized.set(sheet.page.name.trim().toLowerCase(), sheet.page.name)
  }

  const weights = new Map<string, number>()
  for (const link of links) {
    if (link.kind !== 'wikiLink') continue
    const target = byNormalized.get(link.normalized)
    if (!target || !sheets.has(link.pageName)) continue
    const key = `${link.pageName}\u0000${target}`
    weights.set(key, (weights.get(key) ?? 0) + 1)
  }

  const edges: GraphEdge[] = [...weights.entries()].map(([key, weight]) => {
    const [source, target] = key.split('\u0000')
    return { source, target, weight }
  })

  return {
    nodes,
    edges,
    contentTypes: contentTypes
      .filter((ct) => used.has(ct.id))
      .map((ct) => ({ id: ct.id, name: ct.name })),
  }
}

/**
 * Search the scanned garden.
 *
 * Substring matching over block content, ranked by how early and how often the
 * query appears. Deliberately not the server's ranking: that is Tantivy's BM25
 * over a real index, and reproducing it in the browser is not worth the weight.
 * Results are the same set; the order can differ, which the plan records as a
 * known divergence.
 */
export function searchIndex(index: GardenIndex, query: string, limit = 20): SearchResult[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const results: SearchResult[] = []
  for (const sheet of index.sheets.values()) {
    for (const block of Object.values(sheet.page.blocks)) {
      const haystack = block.content.toLowerCase()
      const at = haystack.indexOf(needle)
      if (at === -1) continue

      // Earlier and more often scores higher; a whole-content match highest.
      const occurrences = haystack.split(needle).length - 1
      const score = occurrences + 1 / (at + 1) + (haystack === needle ? 1 : 0)
      results.push({
        uuid: block.uuid,
        content: block.content,
        pageName: sheet.page.name,
        pageTitle: sheet.meta.title,
        isJournal: sheet.page.isJournal,
        score,
      })
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, Math.max(0, limit))
}

/** The backlinks of a page or tag page, as `/pages/{name}/backlinks` answers. */
export function backlinksOf(index: GardenIndex, name: string): BacklinkRef[] {
  // A tag page's name is "tags/<tag>"; its backlinks are the tag's mentions.
  const lookup = name.startsWith('tags/') ? name.slice('tags/'.length) : name
  return index.backlinks.get(lookup.trim().toLowerCase()) ?? []
}
