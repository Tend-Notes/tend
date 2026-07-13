// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Touch-only floating format bar (V2): on a text selection on a coarse-pointer
// device, a bar floats over it; tapping Bold wraps the selection in **. It stays
// hidden on desktop (fine pointer), where Mod-b handles formatting.

import { launch, seedJournal, check, done, APP, API } from './lib.mjs'

const DATE = '2099-10-20'
await seedJournal(DATE, [{ content: 'hello world' }])
const block = async () =>
  Object.values((await (await fetch(`${API}/journals/${DATE}`)).json()).blocks)[0]

const browser = await launch()
try {
  // --- Desktop (fine pointer): bar must NOT appear ---
  const d = await (await browser.newContext({ viewport: { width: 1000, height: 800 } })).newPage()
  await d.addInitScript(() => localStorage.setItem('tend-settings', JSON.stringify({ state: { useLegacyEditor: false }, version: 1 })))
  await d.goto(`${APP}/journal/${DATE}`, { waitUntil: 'networkidle' })
  await d.waitForFunction(() => document.body.innerText.includes('hello world'), { timeout: 15000 })
  await d.getByText('hello world', { exact: false }).first().click()
  await d.keyboard.press('End')
  for (let i = 0; i < 5; i++) await d.keyboard.press('Shift+ArrowLeft')
  await d.waitForTimeout(300)
  check('desktop: no format bar on selection', (await d.locator('.selection-pill').count()) === 0)
  await d.context().close()

  // --- Touch (coarse pointer): bar appears, Bold wraps ---
  const t = await (await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 } })).newPage()
  await t.addInitScript(() => localStorage.setItem('tend-settings', JSON.stringify({ state: { useLegacyEditor: false }, version: 1 })))
  await t.goto(`${APP}/journal/${DATE}`, { waitUntil: 'networkidle' })
  await t.waitForFunction(() => document.body.innerText.includes('hello world'), { timeout: 15000 })
  check('touch context reports coarse pointer', await t.evaluate(() => window.matchMedia('(pointer: coarse)').matches))

  await t.getByText('hello world', { exact: false }).first().click()
  await t.keyboard.press('End')
  for (let i = 0; i < 5; i++) await t.keyboard.press('Shift+ArrowLeft') // select "world"
  await t.waitForTimeout(400)
  check('touch: format bar appears on selection', (await t.locator('.selection-pill').count()) === 1)

  await t.locator('.selection-pill button[aria-label="Bold"]').click()
  await t.waitForTimeout(1000)
  const c = (await block()).content
  console.log('block after Bold:', JSON.stringify(c))
  check('Bold wrapped the selection (hello **world**)', c === 'hello **world**')

  done()
} finally {
  await browser.close()
}
