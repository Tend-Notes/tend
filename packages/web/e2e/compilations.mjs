// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Compilations: a "namespaced" content type. Ctrl-K "Link or create" gains a Book
// field; entering a book + title inserts a [[books/Book/Title]] wiki-link, and
// navigating to it creates the entry under the namespace subfolder.

import { launch, seedJournal, check, done, APP, API } from './lib.mjs'

const DATE = '2099-08-20'
await seedJournal(DATE, [{ content: 'start ' }])

// Register the namespaced "book" content type on the backend.
await fetch(`${API}/content-types`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    content_types: [
      { id: 'page', name: 'Page', directory: 'pages', organization: 'flat', template: '' },
      { id: 'journal', name: 'Journal', directory: 'journals', organization: 'dateNamed', template: '' },
      { id: 'book', name: 'Book', directory: 'books', organization: 'namespaced', template: '' },
    ],
  }),
})

const browser = await launch()
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
  await page.addInitScript(() =>
    localStorage.setItem('tend-settings', JSON.stringify({ state: {
      contentTypes: [
        { id: 'page', name: 'Page', directory: 'pages', organization: 'flat', template: '' },
        { id: 'journal', name: 'Journal', directory: 'journals', organization: 'dateNamed', template: '' },
        { id: 'book', name: 'Book', directory: 'books', organization: 'namespaced', template: '' },
      ],
    }, version: 1 })))
  await page.goto(`${APP}/journal/${DATE}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.body.innerText.includes('start'), { timeout: 15000 })
  await page.getByText('start', { exact: false }).first().click()
  await page.keyboard.press('End')

  // Ctrl-K -> "Link or create Book"
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(300)
  await page.keyboard.type('link or create book', { delay: 5 })
  await page.waitForTimeout(300)
  await page.getByText('Link or create Book', { exact: false }).first().click()
  await page.waitForTimeout(400)

  // The namespaced flow shows two levels: a Compilation field on top, then a File
  // field below it. The File level is inert until a compilation is chosen.
  check('Compilation field present', (await page.getByPlaceholder('Choose or create a book…').count()) === 1)
  check(
    'file level prompts for a compilation first',
    (await page.getByText('Choose or create a compilation first', { exact: false }).count()) === 1,
  )
  check('file field hidden before a compilation is chosen', (await page.getByPlaceholder('Choose or create a file…').count()) === 0)
  await page.getByPlaceholder('Choose or create a book…').fill('MyNovel')
  await page.waitForTimeout(200)
  check('file field appears once a compilation is chosen', (await page.getByPlaceholder('Choose or create a file…').count()) === 1)
  await page.getByPlaceholder('Choose or create a file…').fill('Chapter One')
  await page.waitForTimeout(300)
  await page.getByText('Create "Chapter One" in MyNovel', { exact: false }).click()
  await page.waitForTimeout(600)

  const blockText = await page.evaluate(() => document.querySelector('.outline2 .ProseMirror')?.textContent || '')
  console.log('editor text:', JSON.stringify(blockText))
  check('inserted [[books/MyNovel/Chapter One]] wiki-link', blockText.includes('[[books/MyNovel/Chapter One]]'))

  // Navigate to it (create-on-404) and confirm the entry exists under the namespace.
  await page.goto(`${APP}/books/MyNovel/Chapter%20One`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const sheets = await (await fetch(`${API}/sheets/book`)).json()
  console.log('book sheets:', JSON.stringify(sheets.map((s) => s.name)))
  check('entry created under the namespace', sheets.some((s) => s.name === 'books/MyNovel/Chapter One'))

  // Regression: an existing entry whose name CONTAINS the typed text (but does not
  // start with it) must not suppress "Create new". Here "books/MyNovel/Chapter One"
  // now exists; typing "One" in the same book must still offer to create "One".
  await page.goto(`${APP}/journal/${DATE}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.body.innerText.includes('start'), { timeout: 15000 })
  await page.getByText('start', { exact: false }).first().click()
  await page.keyboard.press('End')
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(300)
  await page.keyboard.type('link or create book', { delay: 5 })
  await page.waitForTimeout(300)
  await page.getByText('Link or create Book', { exact: false }).first().click()
  await page.waitForTimeout(400)
  await page.getByPlaceholder('Choose or create a book…').fill('MyNovel')
  await page.waitForTimeout(200)
  await page.getByPlaceholder('Choose or create a file…').fill('One')
  await page.waitForTimeout(300)
  check(
    'create offered despite an existing entry that contains the query',
    (await page.getByText('Create "One" in MyNovel', { exact: false }).count()) === 1,
  )

  // And a true same-path collision (same book + same title) correctly hides create —
  // there you link the existing sheet instead of creating a duplicate at the same path.
  await page.getByPlaceholder('Choose or create a file…').fill('Chapter One')
  await page.waitForTimeout(300)
  check(
    'create hidden on exact same-path collision',
    (await page.getByText('Create "Chapter One" in MyNovel', { exact: false }).count()) === 0,
  )

  done()
} finally {
  await browser.close()
}
