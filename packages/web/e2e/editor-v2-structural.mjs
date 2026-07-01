// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Editor V2 (ProseMirror node-model): structural outline ops round-trip to the
// model. Enter splits into a sibling, Tab indents, Shift-Tab outdents, and uuids
// stay stable/unique. Runs with the V2 flag enabled via the persisted settings
// store. Save latency = editor debounce + store server debounce, hence the waits.

import { launch, seedJournal, check, done, APP, API } from './lib.mjs'

const DATE = '2099-08-03'
await seedJournal(DATE, [{ content: 'alpha' }])

const browser = await launch()
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } })
  await page.addInitScript(() => localStorage.setItem('tend-settings', JSON.stringify({ state: { outlineEditorV2: true }, version: 1 })))
  await page.goto(`${APP}/journal/${DATE}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.body.innerText.includes('alpha'), { timeout: 15000 })

  check('V2 mounted (ProseMirror), not V1', await page.evaluate(() =>
    !!document.querySelector('.outline2 .ProseMirror') && !document.querySelector('.outliner-editor')))

  const blocks = async () => Object.values((await (await fetch(`${API}/journals/${DATE}`)).json()).blocks)

  // Enter -> new sibling; type beta.
  await page.getByText('alpha', { exact: false }).first().click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('beta', { delay: 0 })
  await page.waitForTimeout(1500)
  let bs = await blocks()
  check(`Enter split created a second block (got ${bs.length})`, bs.length === 2)
  check('both alpha and beta present', bs.some((b) => b.content === 'alpha') && bs.some((b) => b.content === 'beta'))
  const uuids = new Set(bs.map((b) => b.uuid))
  check('uuids are unique', uuids.size === bs.length && !uuids.has(''))

  // Tab -> indent beta under alpha.
  await page.keyboard.press('Tab')
  await page.waitForTimeout(1500)
  bs = await blocks()
  const alpha = bs.find((b) => b.content === 'alpha')
  const beta = bs.find((b) => b.content === 'beta')
  check('Tab indented beta under alpha', beta.parentUuid === alpha.uuid && alpha.children.includes(beta.uuid))

  // Shift-Tab -> outdent beta back to root.
  await page.keyboard.press('Shift+Tab')
  await page.waitForTimeout(1500)
  bs = await blocks()
  check('Shift-Tab outdented beta back to root', bs.find((b) => b.content === 'beta').parentUuid === null)
} finally {
  await browser.close()
}
done()
