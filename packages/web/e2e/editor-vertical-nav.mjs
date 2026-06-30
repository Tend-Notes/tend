// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// EF-10: pressing ArrowUp from a block into a MULTI-LINE previous block should
// land the caret on that block's LAST line (at the column), not its first line.

import { launch, seedJournal, check, done, APP } from './lib.mjs'

const DATE = '2099-12-29'

await seedJournal(DATE, [
  { content: 'Line one of alpha\nLine two of alpha\nLine three last of alpha' },
  { content: 'Below block beta' },
])
const browser = await launch()
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  await page.goto(`${APP}/journal/${DATE}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.body.innerText.includes('Below block beta'), { timeout: 15000 })

  // Activate the lower block, caret at its start, then ArrowUp.
  const beta = page.getByText('Below block beta', { exact: false }).first()
  await beta.click()
  await beta.click()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(800)

  const caretTop = await page.evaluate(() => {
    const r = window.getSelection()?.getRangeAt(0)?.getBoundingClientRect()
    return r ? r.top : null
  })
  const firstLine = await page.getByText('Line one of alpha', { exact: false }).first().boundingBox()
  const lastLine = await page.getByText('Line three last of alpha', { exact: false }).first().boundingBox()

  check('caret has a position', caretTop !== null)
  check(
    'caret landed on LAST line of previous block (not first)',
    caretTop !== null && Math.abs(caretTop - lastLine.y) < Math.abs(caretTop - firstLine.y),
  )
} finally {
  await browser.close()
}
done()
