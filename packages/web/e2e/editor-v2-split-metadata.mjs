// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Editor V2: pressing Enter to make a new bullet must NOT copy the previous
// bullet's block properties (a task's priority/dates). Regression: splitListItem
// passed null attrs, so the new list_item inherited the split node's attrs.

import { launch, check, done, APP, API } from './lib.mjs'

const DATE = '2099-12-09'
const uuid = crypto.randomUUID()
// Seed a TODO that already carries metadata (priority + due date).
await fetch(`${API}/journals/${DATE}`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ blocks: [{ uuid, content: 'TODO first', parent_uuid: null, children: [], collapsed: false, properties: { priority: '2', due_date: '2099-01-01' } }], version: null }),
})

const browser = await launch()
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  await page.addInitScript(() => localStorage.setItem('tend-settings', JSON.stringify({ state: { useLegacyEditor: false }, version: 1 })))
  await page.goto(`${APP}/journal/${DATE}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.body.innerText.includes('first'), { timeout: 15000 })

  // Caret at end of the first TODO, Enter to make a new bullet, type a second TODO.
  await page.getByText('first', { exact: false }).first().click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('TODO second', { delay: 0 })
  await page.waitForTimeout(1500)

  const blocks = Object.values((await (await fetch(`${API}/journals/${DATE}`)).json()).blocks)
  const first = blocks.find((b) => b.content === 'TODO first')
  const second = blocks.find((b) => b.content === 'TODO second')
  check(`created two blocks (got ${blocks.length})`, blocks.length === 2 && !!first && !!second)
  check('first TODO kept its metadata', first?.properties?.priority === '2' && first?.properties?.due_date === '2099-01-01')
  check(`second TODO did NOT inherit metadata (got ${JSON.stringify(second?.properties)})`, Object.keys(second?.properties ?? {}).length === 0)
} finally {
  await browser.close()
}
done()
