// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Palette "Link or create": naming a sheet there is an explicit "make this", so
// the sheet must exist as soon as the link is inserted — without waiting for
// someone to visit the link. Creating it must NOT count as a visit, so it stays
// out of the sidebar's recents until it is actually opened.
import { launch, seedJournal, check, done, APP, API } from './lib.mjs'

const H = { 'Content-Type': 'application/json' }
const cts = await (await fetch(`${API}/content-types`)).json()
if (!cts.find((c) => c.id === 'person')) {
  cts.push({ id: 'person', name: 'Person', directory: 'people', organization: 'flat', template: '' })
  await fetch(`${API}/content-types`, { method: 'PUT', headers: H, body: JSON.stringify({ content_types: cts }) })
}
const DATE = '2099-07-07'
await seedJournal(DATE, [{ content: 'start ' }])

const sheetNames = async () => (await (await fetch(`${API}/sheets/person`)).json()).map((s) => s.name)
// The palette inserts the link immediately and creates in the background, so
// poll rather than sleeping a fixed amount.
const waitForSheet = async (name, ms = 8000) => {
  const deadline = Date.now() + ms
  for (;;) {
    const names = await sheetNames()
    if (names.includes(name) || Date.now() > deadline) return names
    await new Promise((r) => setTimeout(r, 200))
  }
}
const recents = (page) => page.evaluate(() => {
  const raw = localStorage.getItem('tend-recent-sheets')
  return raw ? JSON.stringify(JSON.parse(raw)) : '(none)'
})

const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
await page.addInitScript(() => localStorage.setItem('tend-settings', JSON.stringify({ state: { useLegacyEditor: false }, version: 1 })))
await page.goto(`${APP}/journal/${DATE}`, { waitUntil: 'networkidle' })
await page.waitForFunction(() => document.body.innerText.includes('start'), { timeout: 15000 })
await page.getByText('start', { exact: false }).first().click()
await page.keyboard.press('End')

await page.keyboard.press('Control+k')
await page.waitForTimeout(300)
await page.keyboard.type('link or create person', { delay: 5 })
await page.waitForTimeout(300)
await page.getByText('Link or create Person', { exact: false }).first().click()
await page.waitForTimeout(400)
await page.getByPlaceholder(/Search persons/i).fill('Ada Lovelace')
await page.waitForTimeout(300)
await page.locator('[data-picker-create]').click()
await page.waitForTimeout(1200)

const text = await page.evaluate(() => document.querySelector('.outline2 .ProseMirror')?.textContent || '')
check('link inserted', text.includes('[[people/Ada Lovelace]]'))
const names = await waitForSheet('people/Ada Lovelace')
console.log('sheets after create:', JSON.stringify(names))
check('sheet exists without visiting it', names.includes('people/Ada Lovelace'))

const before = await recents(page)
console.log('recents after create:', before)
check('creating it does NOT record a recent sheet', !before.includes('Ada Lovelace'))

// Visiting it does record one.
await page.goto(`${APP}/people/Ada%20Lovelace`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
const after = await recents(page)
console.log('recents after visit:', after.slice(0, 200))
check('visiting it does record a recent sheet', after.includes('Ada Lovelace'))

await browser.close()
done()
