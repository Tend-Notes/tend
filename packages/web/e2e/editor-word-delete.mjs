// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// EF-09: Ctrl/Cmd+Backspace (word delete) at the START of a block should merge
// it into the previous block, not no-op. Verifies the new boundary keybinding.

import { launch, seedJournal, check, done, APP, API } from './lib.mjs'

const DATE = '2099-12-30'

await seedJournal(DATE, [{ content: 'First bullet content' }, { content: 'Second bullet content' }])
const browser = await launch()
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  await page.addInitScript(() => localStorage.setItem('tend-settings', JSON.stringify({ state: { useLegacyEditor: true }, version: 1 })))
  await page.goto(`${APP}/journal/${DATE}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.body.innerText.includes('Second bullet content'), { timeout: 15000 })

  const before = await (await fetch(`${API}/journals/${DATE}`)).json()
  check('starts with 2 blocks', Object.keys(before.blocks).length === 2)

  // Activate the second bullet (two-click activation), put the caret at the very
  // start, then word-delete backward with the modifier key.
  const target = page.getByText('Second bullet content', { exact: false }).first()
  await target.click()
  await target.click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Control+Backspace')
  await page.waitForTimeout(1300) // debounced save

  const after = await (await fetch(`${API}/journals/${DATE}`)).json()
  const blocks = Object.values(after.blocks)
  check('merged into 1 block', blocks.length === 1)
  check('content concatenated', blocks.some((b) => b.content === 'First bullet contentSecond bullet content'))
} finally {
  await browser.close()
}
done()
