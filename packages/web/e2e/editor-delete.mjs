// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// EF-01 end-to-end: a cross-block delete that spans a COLLAPSED parent must
// delete the parent's hidden descendants (no orphans) and surface the
// "N hidden child bullets also deleted" notification.
//
// Uses a fixed far-future journal date so it never touches a real "today".

import { launch, seedJournal, check, done, APP, API } from './lib.mjs'

const DATE = '2099-12-31'

const tree = [
  { content: 'Alpha —', children: [
    { content: 'Beta —', children: [
      { content: 'Gamma —', children: [
        { content: 'Delta —', children: [{ content: 'Epsilon —' }] },
      ] },
    ] },
    { content: 'Zeta —' },
  ] },
  { content: 'ETA [COLLAPSED] —', collapsed: true, children: [
    { content: 'Theta —', children: [{ content: 'Iota —', children: [{ content: 'Kappa —' }] }] },
    { content: 'Lambda —' },
  ] },
  { content: 'Mu —' },
]

await seedJournal(DATE, tree)
const browser = await launch()
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  await page.goto(`${APP}/journal/${DATE}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.body.innerText.includes('Alpha —'), { timeout: 15000 })

  // Drag-select from "Zeta" down through the collapsed "ETA" bullet, then delete.
  const zeta = await page.getByText('Zeta —', { exact: false }).first().boundingBox()
  const eta = await page.getByText('[COLLAPSED]', { exact: false }).first().boundingBox()
  await page.mouse.move(zeta.x + 5, zeta.y + zeta.height / 2)
  await page.mouse.down()
  await page.mouse.move(eta.x + eta.width / 2, eta.y + eta.height / 2, { steps: 12 })
  await page.mouse.up()
  await page.keyboard.press('Delete')
  await page.waitForTimeout(400)

  const notice = await page.evaluate(
    () => document.body.innerText.split('\n').find((l) => /\d+ hidden child .*also deleted/.test(l)) || null,
  )
  check('notification: "4 hidden child bullets also deleted"', notice === '4 hidden child bullets also deleted')

  await page.waitForTimeout(1300) // debounced save
  const after = await (await fetch(`${API}/journals/${DATE}`)).json()
  const blocks = Object.values(after.blocks)
  const ids = new Set(blocks.map((b) => b.uuid))
  check('block count == 7 (was 12)', blocks.length === 7)
  check('no dangling parents (no orphans)', blocks.every((b) => !b.parentUuid || ids.has(b.parentUuid)))
  check('ETA deleted', !blocks.some((b) => b.content.includes('[COLLAPSED]')))
  check('hidden descendants deleted', !blocks.some((b) => /Theta|Iota|Kappa|Lambda/.test(b.content)))
  check('Mu kept', blocks.some((b) => b.content.includes('Mu —')))
} finally {
  await browser.close()
}
done()
