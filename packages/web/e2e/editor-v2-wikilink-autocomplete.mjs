// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Editor V2: typing `[[` opens a fuzzy page-lookup popup; filtering narrows it;
// selecting inserts a full `[[Page]]` wiki-link.

import { launch, seedJournal, check, done, APP, API } from './lib.mjs'

const DATE = '2099-10-10'
await seedJournal(DATE, [{ content: 'link here ' }])
// A page to find via the popup.
await fetch(`${API}/pages/Target`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    blocks: [{ uuid: crypto.randomUUID(), content: 'target body', parent_uuid: null, children: [], collapsed: false, properties: {} }],
    version: null,
  }),
})

const browser = await launch()
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
  await page.addInitScript(() => localStorage.setItem('tend-settings', JSON.stringify({ state: { useLegacyEditor: false }, version: 1 })))
  await page.goto(`${APP}/journal/${DATE}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.body.innerText.includes('link here'), { timeout: 15000 })

  await page.getByText('link here', { exact: false }).first().click()
  await page.keyboard.press('End')

  const popup = () => page.evaluate(() => {
    const el = document.querySelector('.fixed.z-50')
    return el ? el.textContent : null
  })

  // Typing `[[` opens the popup (lists pages).
  await page.keyboard.type('[[', { delay: 30 })
  await page.waitForFunction(() => {
    const el = document.querySelector('.fixed.z-50')
    return el && !/Loading/.test(el.textContent || '')
  }, { timeout: 8000 })
  check('popup opened on [[ and lists Target', (await popup())?.includes('Target'))

  // Filter to the page, then Enter to insert.
  await page.keyboard.type('Tar', { delay: 40 })
  await page.waitForTimeout(300)
  check('popup still shows Target after filtering', (await popup())?.includes('Target'))
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)

  const text = await page.evaluate(() => document.querySelector('.outline2 .ProseMirror')?.textContent || '')
  console.log('editor text after select:', JSON.stringify(text))
  check('inserted a full [[Target]] wiki-link', text.includes('[[Target]]'))
  check('popup closed after select', (await popup()) === null)

  done()
} finally {
  await browser.close()
}
