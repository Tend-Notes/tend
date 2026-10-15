// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Garden lock badge: the page-title row must say whether the open garden is
// encrypted, and whether a plaintext full-text index of it exists right now.
//   no badge = unencrypted garden
//   grey     = encrypted, no index resident
//   orange   = encrypted but not fully secured (index in RAM, or left on disk)
//
// Run against a backend started with TEND_BASE_DIR pointed somewhere
// disposable - this creates gardens.

import { launch, APP, API, check, done } from './lib.mjs'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

const BADGE = '[aria-label^="Encrypted garden"]'
const ORANGE = 'rgb(224, 123, 31)' // #e07b1f, the hardcoded warning orange

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path}: HTTP ${res.status} ${await res.text()}`)
  return res.json()
}

async function gardens() {
  const res = await fetch(`${API}/gardens`)
  if (!res.ok) throw new Error(`GET /gardens: HTTP ${res.status}`)
  return res.json()
}

// The badge, once the title row has settled. Returns null when absent.
async function badge(page) {
  await page.waitForSelector('h1', { timeout: 10000 })
  const el = page.locator(BADGE)
  if ((await el.count()) === 0) return null
  return {
    legend: await el.getAttribute('aria-label'),
    title: await el.getAttribute('title'),
    color: await el.evaluate((n) => getComputedStyle(n).color),
    background: await el.evaluate((n) => getComputedStyle(n).backgroundColor),
  }
}

const PASS = 'correct-horse-battery-staple'
const before = await gardens()
const plainId = before.gardens.find((g) => !g.encrypted)?.id ?? before.active

// Re-runnable: gardens can't be created twice, and encryption can't be changed
// after creation, so reuse them if an earlier run left them behind.
async function ensureGarden(name, body) {
  if (!(await gardens()).gardens.some((g) => g.name === name)) {
    await post('/gardens', { name, ...body, passphrase: PASS })
  }
  return (await gardens()).gardens.find((g) => g.name === name)
}

const noSearch = await ensureGarden('Sealed No Search', {
  path: 'sealed-no-search',
  search_enabled: false,
})
const searchable = await ensureGarden('Sealed Searchable', {
  path: 'sealed-searchable',
  search_enabled: true,
  index_ttl_hours: 12,
})
check('setup: both encrypted gardens exist', !!noSearch && !!searchable)

const browser = await launch()
const page = await browser.newPage()

// --- Unencrypted garden: nothing to say --------------------------------
{
  await post('/gardens/switch', { id: plainId })
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  check('unencrypted garden: no lock badge', (await badge(page)) === null)
}

// --- Encrypted, search off: grey ---------------------------------------
{
  await post('/gardens/unlock', { id: noSearch.id, passphrase: PASS })
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  const b = await badge(page)
  check('encrypted, search off: badge is shown', b !== null)
  check('encrypted, search off: legend says no index exists', /no search index exists/.test(b?.legend ?? ''))
  check('encrypted, search off: icon is grey, not orange', b?.color !== ORANGE)
  check('encrypted, search off: has a disc background', b?.background !== 'rgba(0, 0, 0, 0)')
  check('encrypted, search off: legend is also the mouseover title', b?.title === b?.legend)
}

// --- Encrypted, search on: orange, in-memory wording -------------------
{
  await post('/gardens/unlock', { id: searchable.id, passphrase: PASS })
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  const b = await badge(page)
  check('encrypted, search on: badge is shown', b !== null)
  check('encrypted, search on: legend says not fully secured', /not fully secured/.test(b?.legend ?? ''))
  check('encrypted, search on: legend names the in-memory index', /in memory/.test(b?.legend ?? ''))
  check('encrypted, search on: icon is the warning orange', b?.color === ORANGE)
}

// --- A plaintext index left on disk: stronger wording ------------------
{
  const indexPath = join(searchable.path, '.tend', 'search_index')
  await mkdir(indexPath, { recursive: true })
  await writeFile(join(indexPath, 'meta.json'), '{}')
  await page.reload({ waitUntil: 'domcontentloaded' })
  const b = await badge(page)
  check('index on disk: legend names the on-disk leak', /left on disk/.test(b?.legend ?? ''))
  check('index on disk: icon is the warning orange', b?.color === ORANGE)

  await rm(indexPath, { recursive: true, force: true })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const after = await badge(page)
  check('index removed: back to the in-memory wording', /in memory/.test(after?.legend ?? ''))
}

// --- Switching to an unencrypted garden, no reload ---------------------
{
  // The switch is only noticed via the garden_switched WebSocket event, so the
  // app's socket has to be up before we switch - otherwise the event is sent
  // into a closed connection and nothing refetches.
  const socket = page.waitForEvent('websocket', {
    predicate: (ws) => ws.url().endsWith('/ws'),
    timeout: 15000,
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await socket
  await badge(page)

  await post('/gardens/switch', { id: plainId })
  // garden_switched sets currentGraphId, which is what makes the badge refetch
  // without a page load.
  await page.waitForSelector(BADGE, { state: 'detached', timeout: 15000 }).catch(() => {})
  check('switch to unencrypted in-session: badge disappears', (await badge(page)) === null)
}

await browser.close()
done()
