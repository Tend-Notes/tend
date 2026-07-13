// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Setting a task to DOING from the task manager starts its work timer; moving it
// off DOING stops the timer and logs the entry to the task's work_log.

import { launch, seedJournal, check, done, APP, API } from './lib.mjs'

const DATE = '2099-12-01'
await seedJournal(DATE, [{ content: 'TODO timeme' }])

const journalBlock = async () => {
  const p = await (await fetch(`${API}/journals/${DATE}`)).json()
  return Object.values(p.blocks).find((b) => b.content.includes('timeme'))
}

const browser = await launch()
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  await page.addInitScript(() => localStorage.setItem('tend-settings', JSON.stringify({ state: { useLegacyEditor: false }, version: 1 })))
  await page.goto(`${APP}/journal/${DATE}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.body.innerText.includes('timeme'), { timeout: 15000 })

  await page.locator('[aria-label="Open task view"]').click()
  await page.waitForFunction(() => document.body.innerText.includes('Tasks'), { timeout: 5000 })
  await page.getByRole('button', { name: 'All active' }).click()

  const row = page.locator('li', { hasText: 'timeme' })
  await row.waitFor({ timeout: 5000 })
  const banner = page.locator('[title="Stop and log time"]')

  check('no timer running initially', (await banner.count()) === 0)

  // TODO -> DOING: starts the timer.
  await row.getByRole('button', { name: 'TODO', exact: true }).click()
  await page.waitForTimeout(1200)
  check('timer started on DOING (banner visible)', (await banner.count()) === 1)

  // Let it accumulate a beat, then DOING -> next status: stops + logs.
  await page.waitForTimeout(1200)
  await row.getByRole('button', { name: 'DOING', exact: true }).click()
  await page.waitForTimeout(1500)
  check('timer stopped when leaving DOING (banner gone)', (await banner.count()) === 0)

  const block = await journalBlock()
  let log = []
  try { log = JSON.parse(block?.properties?.work_log ?? '[]') } catch { /* */ }
  console.log('work_log entries:', log.length, 'first durationMs:', log[0]?.durationMs)
  check('a work_log entry was persisted', log.length === 1)
  check('logged entry has a duration', typeof log[0]?.durationMs === 'number')

  done()
} finally {
  await browser.close()
}
