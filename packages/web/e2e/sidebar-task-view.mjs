// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Sidebar task-view UX:
//  - the collapsed-rail "Task view" button opens the full-page task manager;
//  - the expanded sidebar's "Expand task manager" button opens it AND collapses
//    the sidebar (the collapsed rail returns).

import { launch, seedJournal, check, done, APP } from './lib.mjs'

const DATE = '2099-11-03'
await seedJournal(DATE, [{ content: 'sidebar probe' }])

const browser = await launch()
try {
  // Scenario A: collapsed-rail Task View button opens the manager.
  {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
    await page.addInitScript(() => localStorage.setItem('tend-settings', JSON.stringify({ state: { useLegacyEditor: false }, version: 1 })))
    await page.goto(`${APP}/journal/${DATE}`, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => document.body.innerText.includes('sidebar probe'), { timeout: 15000 })

    check('collapsed rail shows a Task View button', await page.locator('[aria-label="Open task view"]').count() === 1)
    await page.locator('[aria-label="Open task view"]').click()
    await page.waitForFunction(() => document.body.innerText.includes('Tasks'), { timeout: 5000 })
    check('collapsed Task View button opens the manager', await page.getByRole('heading', { name: 'Tasks' }).count() === 1)
    await page.close()
  }

  // Scenario B: expanding the sidebar's task manager closes the sidebar.
  {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
    await page.addInitScript(() => localStorage.setItem('tend-settings', JSON.stringify({ state: { useLegacyEditor: false }, version: 1 })))
    await page.goto(`${APP}/journal/${DATE}`, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => document.body.innerText.includes('sidebar probe'), { timeout: 15000 })

    // Open the sidebar, switch to the Tasks section.
    await page.locator('[title="Open sidebar"]').click()
    await page.locator('[title="Tasks"]').click()
    // The collapsed rail's Task View button should be gone while expanded.
    await page.waitForTimeout(300)
    check('sidebar is expanded (collapsed rail hidden)', await page.locator('[aria-label="Open task view"]').count() === 0)

    // Click "Expand task manager" -> opens manager AND collapses the sidebar.
    await page.locator('[title="Expand task manager"]').click()
    await page.waitForFunction(() => document.body.innerText.includes('Tasks'), { timeout: 5000 })
    await page.locator('[aria-label="Open task view"]').waitFor({ timeout: 5000 })
    check('expand button opened the manager', await page.getByRole('heading', { name: 'Tasks' }).count() === 1)
    check('expand button collapsed the sidebar (rail returned)', await page.locator('[aria-label="Open task view"]').count() === 1)
    await page.close()
  }
} finally {
  await browser.close()
}
done()
