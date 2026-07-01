// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Keyboard cross-block delete: Shift+ArrowUp selects bullets and Delete removes
// them. Previously only mouse drag-select worked, because a keyboard selection
// leaves focus on <body> (not the container) and the Delete handler was
// container-scoped. Asserts both that the keyboard selection is intact (spans
// >=2 blocks) and that Delete then removes the right blocks with no orphans.

import { launch, seedJournal, check, done, APP, API } from './lib.mjs'

const DATE = '2099-12-27'

await seedJournal(DATE, [{ content: 'First bullet' }, { content: 'Second bullet' }, { content: 'Third bullet' }])
const browser = await launch()
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  await page.addInitScript(() => localStorage.setItem('tend-settings', JSON.stringify({ state: { useLegacyEditor: true }, version: 1 })))
  await page.goto(`${APP}/journal/${DATE}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.body.innerText.includes('Third bullet'), { timeout: 15000 })

  check('starts with 3 blocks', Object.keys((await (await fetch(`${API}/journals/${DATE}`)).json()).blocks).length === 3)

  const third = page.getByText('Third bullet', { exact: false }).first()
  await third.click()
  await third.click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+ArrowUp')
  await page.waitForTimeout(250)

  // The keyboard selection must actually span >=2 blocks (not be broken/collapsed).
  const blocksSelected = await page.evaluate(() => {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return 0
    const r = sel.getRangeAt(0)
    return [...document.querySelectorAll('[data-seed-editor]')].filter((el) => r.intersectsNode(el)).length
  })
  check(`Shift+ArrowUp selection spans >=2 blocks (got ${blocksSelected})`, blocksSelected >= 2)

  await page.keyboard.press('Delete')
  await page.waitForTimeout(1300)

  const after = await (await fetch(`${API}/journals/${DATE}`)).json()
  const blocks = Object.values(after.blocks)
  const ids = new Set(blocks.map((b) => b.uuid))
  check(`Delete removed a block (3 -> ${blocks.length})`, blocks.length === 2)
  check('no dangling parents', blocks.every((b) => !b.parentUuid || ids.has(b.parentUuid)))
  check('First bullet untouched', blocks.some((b) => b.content === 'First bullet'))
} finally {
  await browser.close()
}
done()
