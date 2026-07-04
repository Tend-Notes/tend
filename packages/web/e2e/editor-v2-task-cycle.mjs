// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Editor V2 parity: clicking the task status pill cycles the status (TODO ->
// DOING -> DONE), matching the legacy editor, and persists to the model.
import { launch, seedJournal, check, done, APP, API } from './lib.mjs'

const DATE = '2099-08-21'
await seedJournal(DATE, [{ content: 'TODO cycle me' }])
const browser = await launch()
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 400 } })
  await page.addInitScript(() => localStorage.setItem('tend-settings', JSON.stringify({ state: { useLegacyEditor: false }, version: 1 })))
  await page.goto(`${APP}/journal/${DATE}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.body.innerText.includes('cycle me'), { timeout: 15000 })

  const content = async () => Object.values((await (await fetch(`${API}/journals/${DATE}`)).json()).blocks)[0].content
  const clickBadge = () => page.evaluate(() => {
    const b = document.querySelector('.outline2 .task-status-badge')
    const r = b.getBoundingClientRect()
    const o = { bubbles: true, clientX: Math.round(r.x + r.width / 2), clientY: Math.round(r.y + r.height / 2) }
    for (const t of ['mousedown', 'mouseup', 'click']) b.dispatchEvent(new MouseEvent(t, o))
  })

  check('starts TODO', (await content()).startsWith('TODO'))
  await clickBadge(); await page.waitForTimeout(1200)
  check('TODO -> DOING', (await content()).startsWith('DOING'))
  await clickBadge(); await page.waitForTimeout(1200)
  check('DOING -> DONE', (await content()).startsWith('DONE'))
} finally {
  await browser.close()
}
done()
