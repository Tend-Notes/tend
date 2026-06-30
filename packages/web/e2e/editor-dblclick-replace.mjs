// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// EF-20: double-clicking a word in a dormant block selects that word so typing
// replaces it. The two clicks straddle the dormant->active swap (click 1
// activates, click 2 lands on the freshly-mounted CodeMirror), so the editor
// never sees a native double-click; the fix reconstructs the intent by recording
// the activating click and selecting the word on the editor's first mouseup.
// Uses two human-paced clicks (a gap so the editor mounts between them) because
// Playwright's instant dblclick() fires both clicks before React re-renders.

import { launch, seedJournal, check, done, APP, API } from './lib.mjs'

const DATE = '2099-11-02'

await seedJournal(DATE, [{ content: 'Wordzilla destroys Tokyo' }])
const browser = await launch()
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  await page.goto(`${APP}/journal/${DATE}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.body.innerText.includes('Wordzilla'), { timeout: 15000 })

  const word = page.getByText('Wordzilla', { exact: false }).first()
  const box = await word.boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.click(cx, cy)
  await page.waitForTimeout(150)
  await page.mouse.click(cx, cy)
  await page.waitForTimeout(300)

  const sel = await page.evaluate(() => {
    const s = window.getSelection()
    return { text: s ? s.toString() : '', collapsed: s ? s.isCollapsed : true }
  })
  check(`double-click selected a word (got "${sel.text}")`, !sel.collapsed && sel.text.length > 0)

  await page.keyboard.type('X')
  await page.waitForTimeout(1300)
  const after = await (await fetch(`${API}/journals/${DATE}`)).json()
  const content = Object.values(after.blocks)[0].content
  // The selected word was replaced by X (not appended), so exactly one of the
  // three original words survives as "X".
  check(`typing replaced the selected word (got "${content}")`, content.includes('X') && content.length < 'Wordzilla destroys Tokyo'.length)
} finally {
  await browser.close()
}
done()
