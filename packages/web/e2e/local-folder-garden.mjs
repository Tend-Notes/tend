// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// A local-folder garden, end to end, in a real browser.
//
// What only this check can prove: that the whole flow works through the real
// UI, with real IndexedDB, real wasm, and the real editor — and that after
// writing a note into an *encrypted* local garden, nothing readable is left at
// rest in the browser's own storage.
//
// `showDirectoryPicker` needs a user gesture on a real folder and cannot be
// driven from Playwright, so the directory handle is faked in the page. The
// fake is the File System Access API as `LocalFolderStore` uses it, and nothing
// more. Everything above it — the store, the bridge, the backend, the
// dispatcher, the sidebar — is the real thing.
//
// One thing is deliberately not covered here: reconnecting after a browser
// restart. A faked handle cannot be put in IndexedDB — structured clone does
// not carry methods — so the registry keeps it for the session instead, which
// is the same fallback a private window gets. That path is driven directly
// against the fake in localGardenStore.test.ts.

import { launch, APP, check, done } from './lib.mjs'

const PASSPHRASE = 'correct-horse-battery-staple'
const SECRET = 'the-quiet-part-nobody-should-see'

/**
 * An in-page File System Access directory, installed before the app loads.
 *
 * Plain JS on purpose: it has to run in the page, where the project's
 * TypeScript test double is not part of the bundle.
 */
const installFakeFileSystem = () => {
  const notFound = (name) => {
    const e = new Error(`${name} not found`)
    e.name = 'NotFoundError'
    return e
  }

  let clock = 1_700_000_000_000
  const tick = () => (clock += 1000)
  const observers = new Set()

  const makeDir = (name, prefix = '') => {
    const files = new Map()
    const dirs = new Map()
    const pathOf = (child) => (prefix ? `${prefix}/${child}` : child)

    const handle = {
      kind: 'directory',
      name,
      async getDirectoryHandle(child, options) {
        const existing = dirs.get(child)
        if (existing) return existing
        if (!options || !options.create) throw notFound(child)
        const made = makeDir(child, pathOf(child))
        dirs.set(child, made)
        return made
      },
      async getFileHandle(child, options) {
        if (!files.has(child)) {
          if (!options || !options.create) throw notFound(child)
          files.set(child, { bytes: new Uint8Array(), lastModified: tick() })
        }
        return {
          kind: 'file',
          name: child,
          async getFile() {
            const f = files.get(child)
            if (!f) throw notFound(child)
            return new File([f.bytes], child, { lastModified: f.lastModified })
          },
          async createWritable() {
            const chunks = []
            return {
              async write(data) {
                if (typeof data === 'string') chunks.push(new TextEncoder().encode(data))
                else if (data instanceof ArrayBuffer) chunks.push(new Uint8Array(data))
                else chunks.push(new Uint8Array(data))
              },
              async close() {
                const total = chunks.reduce((n, c) => n + c.length, 0)
                const bytes = new Uint8Array(total)
                let at = 0
                for (const c of chunks) {
                  bytes.set(c, at)
                  at += c.length
                }
                const existed = files.has(child) && files.get(child).bytes.length > 0
                files.set(child, { bytes, lastModified: tick() })
                for (const fn of observers) {
                  fn([
                    {
                      type: existed ? 'modified' : 'appeared',
                      relativePathComponents: pathOf(child).split('/'),
                    },
                  ])
                }
              },
              async abort() {
                chunks.length = 0
              },
            }
          },
        }
      },
      async removeEntry(child) {
        if (!files.delete(child)) dirs.delete(child)
      },
      async *entries() {
        for (const key of files.keys()) yield [key, { kind: 'file', name: key }]
        for (const [key, dir] of dirs) yield [key, dir]
      },
      async resolve() {
        return []
      },
      async queryPermission() {
        return 'granted'
      },
      async requestPermission() {
        return 'granted'
      },
      // Test-only: read the whole tree back out, as text.
      __snapshot(at = '') {
        const out = {}
        for (const [key, file] of files) {
          out[at + key] = new TextDecoder().decode(file.bytes)
        }
        for (const [key, dir] of dirs) Object.assign(out, dir.__snapshot(`${at}${key}/`))
        return out
      },
    }
    return handle
  }

  const root = makeDir('e2e-gardens')
  window.__tendFakeRoot = root
  window.showDirectoryPicker = async () => root

  // The watcher's API, so the real watcher code path runs rather than being
  // skipped as unsupported.
  window.FileSystemObserver = class {
    constructor(callback) {
      this.listener = (records) => callback(records)
    }
    observe() {
      observers.add(this.listener)
    }
    disconnect() {
      observers.delete(this.listener)
    }
  }
}

/** Everything the browser has at rest for this origin, as one string. */
const dumpStorage = async () => {
  const chunks = []

  for (const store of [localStorage, sessionStorage]) {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)
      chunks.push(key, store.getItem(key) ?? '')
    }
  }

  const names = await indexedDB.databases()
  for (const { name } of names) {
    if (!name) continue
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(name)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    for (const storeName of [...db.objectStoreNames]) {
      const rows = await new Promise((resolve) => {
        const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll()
        req.onsuccess = () => resolve(req.result ?? [])
        req.onerror = () => resolve([])
      })
      for (const row of rows) {
        // Bytes as well as JSON: a sealed draft is a Uint8Array.
        chunks.push(storeName)
        try {
          chunks.push(JSON.stringify(row))
        } catch {
          chunks.push(String(row))
        }
        for (const value of Object.values(row ?? {})) {
          if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
            chunks.push(new TextDecoder().decode(value))
          }
        }
      }
    }
    db.close()
  }

  if ('caches' in window) {
    for (const key of await caches.keys()) {
      const cache = await caches.open(key)
      for (const request of await cache.keys()) {
        chunks.push(request.url)
        const response = await cache.match(request)
        if (response) chunks.push(await response.clone().text())
      }
    }
  }

  return chunks.join('\n')
}

const browser = await launch()
const page = await browser.newPage()
page.on('pageerror', (e) => console.log(`  page error: ${e.message}`))

await page.addInitScript(installFakeFileSystem)
await page.goto(APP, { waitUntil: 'networkidle' })

// --- open the sidebar's gardens section -------------------------------------

await page.getByTitle('Options').click().catch(() => {})
const settings = page.getByRole('button', { name: /^Settings$/ })
if (await settings.count()) await settings.first().click()
await page.getByText('Gardens', { exact: true }).click()
await page.waitForTimeout(400)

check(
  'the gardens section lists the server gardens',
  (await page.getByRole('button', { name: '+ New garden' }).count()) > 0
)

// --- create an encrypted garden in a local folder -----------------------------
//
// One flow for both kinds of garden: the same form, with Encrypt and "Keep in a
// local folder" beside each other. Ticking the local box explains what changes
// and asks for the gardens folder, since both are irreversible once notes exist.

await page.getByRole('button', { name: '+ New garden' }).click()
await page.getByPlaceholder('Garden name').fill('Sealed')

await page.getByText('Keep in a local folder', { exact: true }).click()
check(
  'ticking local explains what changes before anything is created',
  await page.getByText('Keep this garden in a local folder').isVisible()
)
check(
  'and says the folder has yet to be chosen',
  (await page.getByRole('button', { name: /Continue and choose a folder/ }).count()) > 0
)

// Cancel leaves the box unticked rather than half-committing.
await page.getByRole('button', { name: /^Cancel$/ }).first().click()
await page.waitForTimeout(300)
check(
  'cancelling backs out of it',
  !(await page.getByText('Keep this garden in a local folder').isVisible().catch(() => false))
)

await page.getByText('Keep in a local folder', { exact: true }).click()
await page.getByRole('button', { name: /Continue and choose a folder/ }).click()
await page.waitForTimeout(800)
check(
  'continuing picks the folder and shows which one',
  (await page.getByText('e2e-gardens', { exact: false }).count()) > 0
)

await page.getByText('Encrypt garden', { exact: true }).click()
await page.getByPlaceholder('Passphrase', { exact: true }).fill(PASSPHRASE)
await page.getByPlaceholder('Confirm passphrase').fill(PASSPHRASE)
await page.getByRole('button', { name: /^Create/ }).click()

// scrypt in wasm takes seconds; that is the point of scrypt.
await page.waitForTimeout(12000)

// The app is now serving the local garden: today's journal renders, which for
// a garden with no files means the empty-journal path worked.
await page.waitForFunction(
  () => !!document.querySelector('.ProseMirror') || !!document.querySelector('[contenteditable]'),
  { timeout: 20000 }
)
check(
  'the garden is open and its journal renders',
  await page.evaluate(() => !document.body.innerText.includes('not found'))
)

const afterCreate = await page.evaluate(() => window.__tendFakeRoot.__snapshot())
check('the garden folder was written', Object.keys(afterCreate).length > 0)
check(
  'the identity is wrapped on disk',
  Object.keys(afterCreate).some((p) => p.endsWith('.tend/identity.age'))
)
check(
  'the verify file is there, as the server writes it',
  Object.keys(afterCreate).some((p) => p.endsWith('.tend/encryption.verify'))
)

// --- write a note ------------------------------------------------------------

await page.locator('.ProseMirror, [contenteditable]').first().click()
await page.keyboard.type(SECRET, { delay: 5 })
// Let the debounced save land, then the write itself.
await page.waitForTimeout(4000)

const afterWrite = await page.evaluate(() => window.__tendFakeRoot.__snapshot())
const files = Object.keys(afterWrite)
check('a note file was written', files.some((p) => p.endsWith('.md.age')))
check(
  'no file in the folder holds the note in the clear',
  !Object.values(afterWrite).some((text) => text.includes(SECRET))
)
check(
  'the note file is a real age file',
  Object.entries(afterWrite).some(
    ([p, text]) => p.endsWith('.md.age') && text.includes('age-encryption.org')
  )
)

// --- the at-rest assertion ---------------------------------------------------

const atRest = await page.evaluate(dumpStorage)
check('nothing in browser storage holds the note in the clear', !atRest.includes(SECRET))
check(
  'nothing in browser storage holds the passphrase',
  !atRest.includes(PASSPHRASE)
)

// --- lock it, and confirm the content goes with the key ----------------------

// Back into the sidebar: opening the garden navigated away from settings.
const openGardens = async () => {
  if (await page.getByRole('button', { name: /^Lock$/ }).count()) return
  await page.getByTitle('Options').click().catch(() => {})
  await page.waitForTimeout(300)
  const settingsBtn = page.getByRole('button', { name: /^Settings$/ })
  if (await settingsBtn.count()) await settingsBtn.first().click()
  await page.waitForTimeout(300)
  // The section remembers whether it was open, so one click may collapse it.
  // Click until the gardens list is actually on screen.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (
      await page
        .getByRole('button', { name: '+ New garden' })
        .isVisible()
        .catch(() => false)
    )
      break
    const gardens = page.getByText('Gardens', { exact: true })
    if (await gardens.count()) await gardens.first().click()
    await page.waitForTimeout(500)
  }
}
await openGardens()

const lock = page.getByRole('button', { name: /^Lock$/ })
check('an encrypted local garden can be locked', (await lock.count()) > 0)
if (await lock.count()) {
  await lock.first().click()
  await page.waitForTimeout(1500)

  const sessionAfterLock = await page.evaluate(async () => {
    const { localSession } = await import('/src/lib/local/localBackend.ts')
    return localSession() === null
  })
  check('the identity is gone from memory after locking', sessionAfterLock)
}

await browser.close()
done()
