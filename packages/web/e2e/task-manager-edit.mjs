// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Full-page task manager editing: the collapsed-rail Task View button opens it,
// clicking a task's status pill cycles + persists, and setting priority persists
// to the task's origin page (verified via /todos).

import { launch, seedJournal, check, done, APP, API } from './lib.mjs'

const DATE = '2099-11-02'
await seedJournal(DATE, [{ content: 'TODO tmedittask' }])

const todo = async () =>
  (await (await fetch(`${API}/todos`)).json()).tasks.find((t) => t.content === 'tmedittask')

const browser = await launch()
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  await page.addInitScript(() => localStorage.setItem('tend-settings', JSON.stringify({ state: { useLegacyEditor: false }, version: 1 })))
  await page.goto(`${APP}/journal/${DATE}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.body.innerText.includes('tmedittask'), { timeout: 15000 })

  // Open the full-page task manager via the collapsed-rail Task View button.
  await page.locator('[aria-label="Open task view"]').click()
  await page.waitForFunction(() => document.body.innerText.includes('Tasks'), { timeout: 5000 })
  await page.getByRole('button', { name: 'All active' }).click()

  const row = page.locator('li', { hasText: 'tmedittask' })
  await row.waitFor({ timeout: 5000 })
  check('task row shows a TODO status pill', await row.getByRole('button', { name: 'TODO', exact: true }).count() === 1)

  // Click the status pill -> cycles to DOING and persists.
  await row.getByRole('button', { name: 'TODO', exact: true }).click()
  await page.waitForTimeout(800)
  check('status pill now shows DOING', await row.getByRole('button', { name: 'DOING', exact: true }).count() === 1)
  check('status persisted to origin page (todos = DOING)', (await todo())?.status === 'DOING')

  // Set priority High -> persists.
  await row.getByRole('button', { name: 'Priority' }).click()
  await row.getByRole('button', { name: 'High' }).click()
  await page.waitForTimeout(800)
  check('priority persisted (todos priority = 3)', (await todo())?.priority === '3')

  // Edit the task text -> persists (status kept).
  await row.getByRole('button', { name: 'Edit task text' }).click()
  // Once editing, the text lives in the input's value (not the row's text), so the
  // hasText row filter no longer matches — grab the single editing input directly.
  const input = page.locator('main li input')
  await input.fill('tmedittask-renamed')
  await input.press('Enter')
  await page.waitForTimeout(800)
  const t = await todo() ?? (await (await fetch(`${API}/todos`)).json()).tasks.find((x) => x.content === 'tmedittask-renamed')
  check('text edit persisted (content = "tmedittask-renamed", status kept)', t?.content === 'tmedittask-renamed' && t?.status === 'DOING')
} finally {
  await browser.close()
}
done()
