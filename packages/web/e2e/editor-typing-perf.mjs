// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// EF-07 regression guard: typing on a large page must stay cheap. Each block is
// a memoized BlockRow that re-renders only when its own data changes, so typing
// in one block doesn't re-render the other N-1 rows. If a future change makes a
// per-row prop unstable (handlers, fence map, selection set), the memo stops
// bailing and per-keystroke cost jumps ~10x. This asserts it stays well under
// that — a generous threshold so it catches a real regression, not jitter.
// (Measured: ~12 ms/char memoized vs ~115 ms/char unmemoized at N=1000.)

import { launch, seedJournal, check, done, APP } from './lib.mjs'

const DATE = '2099-10-02'
const N = 1000
const tree = []
for (let i = 0; i < N; i++) tree.push({ content: `Block number ${i} lorem ipsum dolor sit amet` })

await seedJournal(DATE, tree)
const browser = await launch()
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  await page.goto(`${APP}/journal/${DATE}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.body.innerText.includes('Block number 0'), { timeout: 30000 })

  const first = page.getByText('Block number 0', { exact: false }).first()
  await first.click()
  await page.waitForTimeout(300)
  await page.keyboard.press('End')
  // Warm up (JIT, first-render costs) before measuring.
  await page.keyboard.type('xx', { delay: 0 })
  await page.waitForTimeout(300)

  const CHARS = 40
  const t0 = await page.evaluate(() => performance.now())
  await page.keyboard.type('a'.repeat(CHARS), { delay: 0 })
  const t1 = await page.evaluate(() => performance.now())
  const perChar = (t1 - t0) / CHARS
  check(`typing on ${N}-block page stays cheap (${perChar.toFixed(1)} ms/char, threshold 60)`, perChar < 60)
} finally {
  await browser.close()
}
done()
