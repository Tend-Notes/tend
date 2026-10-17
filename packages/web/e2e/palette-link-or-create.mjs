// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Command palette "Link or create ___" panel:
//  - "New ___" command is gone; one entry links existing AND creates.
//  - date-organized types get the journal-page calendar icon + picker as a
//    second-layer filter (narrows Existing by sheet date).
//  - "Create" shows whenever the target path is free. Recurring names are
//    legitimate for by-date types (many "standup" across dates), so a name that
//    merely matches an existing one does NOT hide it — only a true same-path
//    collision does, and there you link the existing sheet instead.

import { launch, seedJournal, check, done, APP, API } from './lib.mjs'

const H = { 'Content-Type': 'application/json' }
const cts = await (await fetch(`${API}/content-types`)).json()
if (!cts.find((c) => c.id === 'meeting')) {
  cts.push({ id: 'meeting', name: 'Meeting', directory: 'meetings', organization: 'dateFoldered', template: '' })
  await fetch(`${API}/content-types`, { method: 'PUT', headers: H, body: JSON.stringify({ content_types: cts }) })
}
for (const [name, date] of [['standup', '2026-01-01'], ['standup', '2026-01-02'], ['retro', '2026-01-01']]) {
  await fetch(`${API}/sheets/meeting`, { method: 'POST', headers: H, body: JSON.stringify({ name, date }) })
}
const DATE = '2099-12-22'
await seedJournal(DATE, [{ content: 'hi' }])

// The command list is cmdk; the link/create panel below it is a LinkPicker,
// whose rows are plain divs tagged data-picker-row / data-picker-create.
const commandTexts = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[cmdk-item]')).map((e) => e.textContent.trim()))
const pickerTexts = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[data-picker-row]')).map((e) => e.textContent.trim()))
const hasCreate = async (page) => (await page.locator('[data-picker-create]').count()) > 0

const browser = await launch()
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 820 } })
  await page.addInitScript(() => localStorage.setItem('tend-settings', JSON.stringify({ state: { useLegacyEditor: false }, version: 1 })))
  await page.goto(`${APP}/journal/${DATE}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.innerText.includes('hi'), { timeout: 15000 })

  await page.keyboard.press('Control+k')
  await page.waitForSelector('[cmdk-item]', { timeout: 5000 })
  await page.keyboard.type('Meeting')
  await page.waitForTimeout(300)
  const cmds = await commandTexts(page)
  check('has "Link or create Meeting..."', cmds.some((t) => /Link or create Meeting/.test(t)))
  check('no "New Meeting" command', !cmds.some((t) => /^New Meeting/.test(t)))

  await page.locator('[cmdk-item]', { hasText: 'Link or create Meeting' }).first().click()
  await page.waitForSelector('[title="Filter by date"]', { timeout: 5000 })
  check('journal calendar icon present', await page.locator('[title="Filter by date"]').count() === 1)

  const search = page.getByPlaceholder(/Search meetings/i)

  // Create gate: free target path -> create offered, whatever the name matches.
  await search.fill('standup') // exists, but only on other dates
  await page.waitForTimeout(200)
  check('create shown for a name that exists on another date (standup)', await hasCreate(page))
  await search.fill('and') // substring of "standup" but not a prefix
  await page.waitForTimeout(200)
  check('create shown for a non-prefix substring match (and)', await hasCreate(page))
  await search.fill('zzz') // no matches
  await page.waitForTimeout(200)
  check('create shown when nothing matches (zzz)', await hasCreate(page))

  // Date filter via the calendar picker.
  await search.fill('')
  await page.waitForTimeout(150)
  await page.locator('[title="Filter by date"]').click()
  for (let i = 0; i < 24; i++) {
    const hdr = (await page.locator('[title="Go to today"]').innerText()).trim()
    if (hdr === 'January 2026') break
    await page.locator('[title="Previous month"]').click()
  }
  await page.getByRole('button', { name: '1', exact: true }).click()
  await page.waitForTimeout(300)
  check('date filter set to 2026-01-01', await page.locator('[title="Clear date filter"]').count() === 1)
  const dated = await pickerTexts(page)
  check('existing narrows to 2026-01-01', dated.some((t) => t.includes('2026-01-01')) && !dated.some((t) => t.includes('2026-01-02')))

  // With the date picked, "standup" now resolves to an existing path — the one
  // case where create is suppressed.
  await search.fill('standup')
  await page.waitForTimeout(250)
  check('create hidden on a same-path collision (standup on 2026-01-01)', !(await hasCreate(page)))
} finally {
  await browser.close()
}
done()
