// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Command palette: the "New ___" command is gone; "Link or create ___" opens one
// panel that links to existing sheets AND creates. For date-organized types it
// exposes a date filter (second layer) that narrows results by sheet date and,
// with 0 matches, offers "Create … on <date>".

import { launch, seedJournal, check, done, APP, API } from './lib.mjs'

const H = { 'Content-Type': 'application/json' }

// Configure a date-foldered "meeting" content type.
const cts = await (await fetch(`${API}/content-types`)).json()
if (!cts.find((c) => c.id === 'meeting')) {
  cts.push({ id: 'meeting', name: 'Meeting', directory: 'meetings', organization: 'dateFoldered', template: '' })
  await fetch(`${API}/content-types`, { method: 'PUT', headers: H, body: JSON.stringify({ content_types: cts }) })
}
// Two "standup" meetings on different dates + one "retro".
for (const [name, date] of [['standup', '2026-01-01'], ['standup', '2026-01-02'], ['retro', '2026-01-01']]) {
  await fetch(`${API}/sheets/meeting`, { method: 'POST', headers: H, body: JSON.stringify({ name, date }) })
}

const DATE = '2099-12-20'
await seedJournal(DATE, [{ content: 'hi' }])

const itemTexts = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[cmdk-item]')).map((e) => e.textContent.trim()))

const browser = await launch()
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
  await page.addInitScript(() => localStorage.setItem('tend-settings', JSON.stringify({ state: { useLegacyEditor: false }, version: 1 })))
  await page.goto(`${APP}/journal/${DATE}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.innerText.includes('hi'), { timeout: 15000 })

  // Open palette, filter to the content-type command.
  await page.keyboard.press('Control+k')
  await page.waitForSelector('[cmdk-item]', { timeout: 5000 })
  await page.keyboard.type('Meeting')
  await page.waitForTimeout(300)
  const cmds = await itemTexts(page)
  check('has "Link or create Meeting..." command', cmds.some((t) => /Link or create Meeting/.test(t)))
  check('no "New Meeting" command remains', !cmds.some((t) => /^New Meeting/.test(t)))

  // Enter the link-or-create panel.
  await page.locator('[cmdk-item]', { hasText: 'Link or create Meeting' }).first().click()
  await page.waitForSelector('input[type="date"]', { timeout: 5000 })
  check('date filter present for date-organized type', await page.locator('input[type="date"]').count() === 1)

  const existing = await itemTexts(page)
  check(`lists existing meetings (got ${existing.length})`, existing.some((t) => t.includes('2026-01-01')) && existing.some((t) => t.includes('2026-01-02')))

  // Date filter → narrow to one date.
  await page.fill('input[type="date"]', '2026-01-01')
  await page.waitForTimeout(300)
  const filtered = await itemTexts(page)
  check('date filter narrows to that date', filtered.some((t) => t.includes('2026-01-01')) && !filtered.some((t) => t.includes('2026-01-02')))

  // Pick a date with no sheets + type a name → "Create … on <date>".
  await page.fill('input[type="date"]', '2026-01-09')
  await page.locator('[cmdk-root] input, input[placeholder^="Search"]').first().fill('planning')
  await page.waitForTimeout(300)
  const withCreate = await itemTexts(page)
  check('offers create on the picked date', withCreate.some((t) => /Create "planning".*on 2026-01-09/.test(t)))
} finally {
  await browser.close()
}
done()
