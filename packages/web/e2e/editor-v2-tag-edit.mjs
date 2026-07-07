// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Editor V2: a tag stays editable text while the caret is inside it (so you can
// type it out), and only collapses to the colored pill once the caret leaves —
// matching V1's tags.ts. Regression guard: the pill used to paint after the
// first letter, under the caret, which blocked editing.

import { launch, seedJournal, check, done, APP } from './lib.mjs'

const DATE = '2099-10-01'
await seedJournal(DATE, [{ content: 'hello' }])

const browser = await launch()
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } })
  await page.addInitScript(() => localStorage.setItem('tend-settings', JSON.stringify({ state: { useLegacyEditor: false }, version: 1 })))
  await page.goto(`${APP}/journal/${DATE}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.body.innerText.includes('hello'), { timeout: 15000 })

  const tagState = () => page.evaluate(() => ({
    tag: document.querySelectorAll('.outline2 .tag').length,
    pill: document.querySelectorAll('.outline2 .tag-pill').length,
  }))

  await page.getByText('hello', { exact: false }).first().click()
  await page.keyboard.press('End')
  await page.keyboard.type(' #foo', { delay: 20 })
  await page.waitForTimeout(300)
  const s1 = await tagState()
  check(`typing "#foo": editable text, no pill (got ${JSON.stringify(s1)})`, s1.tag === 1 && s1.pill === 0)

  // A space moves the caret out of the tag -> it should become the pill.
  await page.keyboard.type(' ', { delay: 20 })
  await page.waitForTimeout(300)
  const s2 = await tagState()
  check(`after space: collapses to pill (got ${JSON.stringify(s2)})`, s2.pill === 1 && s2.tag === 0)

  // Move the caret back onto the tag boundary -> editable again.
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(300)
  const s3 = await tagState()
  check(`caret back inside: editable again (got ${JSON.stringify(s3)})`, s3.tag === 1 && s3.pill === 0)

  // And it is genuinely editable: typing extends the tag text.
  await page.keyboard.type('bar', { delay: 20 })
  await page.waitForTimeout(300)
  const text = await page.evaluate(() => document.querySelector('.outline2 .tag')?.textContent)
  check(`tag is editable — extended to #foobar (got ${JSON.stringify(text)})`, text === '#foobar')
} finally {
  await browser.close()
}
done()
