// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Editor V2 (ProseMirror): clicking a wikilink. Investigates the "expand on
// first click, navigate on second click" behavior across variants:
//   A. plain [[target]] (display == source), editor unfocused
//   B. path [[folder/page]] (collapsed display is last segment), unfocused
//   C. path [[folder/page]] with caret already on that line (link expanded)

import { launch, seedJournal, check, done, APP, API } from './lib.mjs'

const browser = await launch()

async function run(label, content, opts = {}) {
  const DATE = opts.date
  await seedJournal(DATE, [{ content }])
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } })
  await page.addInitScript(() => localStorage.setItem('tend-settings', JSON.stringify({ state: { useLegacyEditor: false }, version: 1 })))
  await page.goto(`${APP}/journal/${DATE}`, { waitUntil: 'networkidle' })
  await page.waitForFunction((c) => document.body.innerText.includes(c), opts.expectText, { timeout: 15000 })

  const wikiInfo = async () => page.evaluate(() => {
    const el = document.querySelector('.wiki-link')
    return el ? { text: el.textContent, target: el.getAttribute('data-target') } : null
  })

  console.log(`\n=== ${label} ===`)
  console.log('  seeded:', JSON.stringify(content))
  console.log('  wiki (collapsed):', JSON.stringify(await wikiInfo()))

  if (opts.preFocus) {
    // Put the caret on the line first (this is what "already editing" looks
    // like) by clicking a non-link word, which expands the link to show the full
    // source. Clicking the link itself would navigate — that's the whole point.
    await page.getByText('here', { exact: false }).first().click()
    await page.waitForTimeout(300)
    console.log('  after placing caret on line, wiki:', JSON.stringify(await wikiInfo()))
  }

  const startUrl = page.url()
  const wl = page.locator('.wiki-link').first()
  await wl.click()
  await page.waitForTimeout(400)
  const url1 = page.url()
  const navigated1 = url1 !== startUrl && !url1.includes(DATE)
  console.log('  URL after click 1:', url1, navigated1 ? '(NAVIGATED)' : '(no nav)')
  check(`${label}: click 1 navigates`, navigated1)

  if (!navigated1) {
    const wl2 = page.locator('.wiki-link').first()
    if (await wl2.count()) {
      await wl2.click()
      await page.waitForTimeout(400)
    }
    const url2 = page.url()
    console.log('  URL after click 2:', url2, url2 !== url1 ? '(NAVIGATED on 2nd)' : '(still no nav)')
  }
  await page.close()
}

try {
  await run('A plain, unfocused', 'see [[target-page]] here', { date: '2099-08-07', expectText: 'target-page' })
  await run('B path, unfocused', 'see [[folder/page]] here', { date: '2099-08-08', expectText: 'page' })
  await run('C path, caret on line', 'see [[folder/page]] here', { date: '2099-08-09', expectText: 'page', preFocus: true })
} finally {
  await browser.close()
}
done()
