// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Longform Mode: a blank page can be converted (Ctrl-K) into a flat wall-of-text
// editor with no bullets; typed prose — including a markdown "- " list line —
// round-trips verbatim through the backend, and inline formatting renders live.

import { launch, check, done, APP, API } from './lib.mjs'

const NAME = 'LongformE2E'

// Seed a blank page (one empty block) so the "Convert to Longform" command is offered.
async function seedBlankPage(name) {
  const res = await fetch(`${API}/pages/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blocks: [{ uuid: crypto.randomUUID(), content: '', parent_uuid: null, children: [], collapsed: false, properties: {} }],
      version: null,
    }),
  })
  if (!res.ok) throw new Error(`seed failed: HTTP ${res.status}`)
}

const getPage = async (name) => (await (await fetch(`${API}/pages/${encodeURIComponent(name)}`)).json())

await seedBlankPage(NAME)

const browser = await launch()
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
  await page.addInitScript(() =>
    localStorage.setItem('tend-settings', JSON.stringify({ state: { useLegacyEditor: false }, version: 1 })))
  await page.goto(`${APP}/page/${NAME}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!document.querySelector('.outline2 .ProseMirror'), { timeout: 15000 })

  // Starts as the V2 outline, not longform.
  check('starts in V2 outline (has list chrome, not .longform)', await page.evaluate(() =>
    !!document.querySelector('.block-container') && !document.querySelector('.longform')))

  // Open the command palette, filter to the command, and click it.
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(300)
  await page.keyboard.type('longform', { delay: 5 })
  await page.waitForTimeout(300)
  await page.getByText('Convert to Longform', { exact: true }).click()

  // The longform editor mounts: flat ProseMirror, no bullet chrome.
  await page.waitForFunction(() => !!document.querySelector('.longform .ProseMirror'), { timeout: 10000 })
  check('longform editor mounted', await page.evaluate(() =>
    !!document.querySelector('.longform .ProseMirror')))
  check('no bullet chrome in longform', await page.evaluate(() =>
    !document.querySelector('.longform .block-container') && !document.querySelector('.longform ul.block-list')))

  // Type multi-paragraph prose including a markdown list line and inline bold.
  await page.click('.longform .ProseMirror')
  await page.keyboard.type('# My Notes', { delay: 3 })
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Some **bold** prose here.', { delay: 3 })
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('- a list line I typed', { delay: 3 })
  await page.waitForTimeout(1500)

  // Bold renders live (decoration applied), and the doc is still one flat block.
  check('inline bold renders (.pm-bold present)', await page.evaluate(() =>
    !!document.querySelector('.longform .pm-bold')))

  // Persisted as a single block with the flag; body verbatim (list line intact).
  let p = await getPage(NAME)
  const blocks = Object.values(p.blocks)
  check('persisted as one block', blocks.length === 1)
  check('longform flag persisted', p.properties?.longform === 'true')
  check('list line survived verbatim (not fractured)', blocks[0]?.content.includes('- a list line I typed'))
  check('bold markers survived', blocks[0]?.content.includes('**bold**'))

  // Reload: still longform, content intact.
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!document.querySelector('.longform .ProseMirror'), { timeout: 15000 })
  check('reopens in longform mode', await page.evaluate(() =>
    !!document.querySelector('.longform .ProseMirror')))
  check('body text present after reload', await page.evaluate(() =>
    document.body.innerText.includes('a list line I typed')))

  done()
} finally {
  await browser.close()
}
