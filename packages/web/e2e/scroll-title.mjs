// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// The pinned "scroll title" must appear once the page title scrolls out of the
// content container, and hide when scrolled back — for both editors (the logic
// is shared in MainContent). Regression: the observer was attached via a
// name-keyed effect that missed the title mount, so it often never fired.

import { launch, seedJournal, check, done, APP } from './lib.mjs'

const DATE = '2099-12-14'
await seedJournal(DATE, Array.from({ length: 80 }, (_, i) => ({ content: `line number ${i} lorem ipsum dolor sit amet consectetur` })))

const browser = await launch()

async function probe(legacy) {
  const label = legacy ? 'V1' : 'V2'
  const page = await browser.newPage({ viewport: { width: 1000, height: 720 } })
  await page.addInitScript((lg) => localStorage.setItem('tend-settings', JSON.stringify({ state: { useLegacyEditor: lg }, version: 1 })), legacy)
  await page.goto(`${APP}/journal/${DATE}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.innerText.includes('line number 0'), { timeout: 15000 })
  await page.waitForTimeout(400)

  const scrollTo = (pos) => page.evaluate((p) => {
    const h1 = document.querySelector('h1')
    let el = h1?.parentElement, sc = null
    while (el) { const cs = getComputedStyle(el); if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 5) { sc = el; break } el = el.parentElement }
    sc.scrollTop = p === 'bottom' ? sc.scrollHeight : 0
  }, pos)
  const pinnedVisible = () => page.evaluate(() => document.querySelector('.scroll-title')?.classList.contains('scroll-title--visible') ?? false)

  const atTop = await pinnedVisible()
  await scrollTo('bottom')
  await page.waitForTimeout(500)
  const scrolled = await pinnedVisible()
  await scrollTo('top')
  await page.waitForTimeout(500)
  const backAtTop = await pinnedVisible()

  await page.close()
  check(`${label}: pinned title hidden at top`, atTop === false)
  check(`${label}: pinned title shows after scrolling title offscreen`, scrolled === true)
  check(`${label}: pinned title hides again when scrolled back to top`, backAtTop === false)
}

try {
  await probe(false) // V2
  await probe(true)  // V1
} finally {
  await browser.close()
}
done()
