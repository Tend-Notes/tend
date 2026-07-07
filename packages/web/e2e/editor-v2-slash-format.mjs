// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Editor V2: slash-command menu + inline formatting keybinds.
//  - Typing "/" opens the menu; filtering works; Enter runs the command and
//    does NOT split the block; the "/query" is replaced by the command text.
//  - Ctrl+B wraps the selection in ** (and other Mod combos map to their
//    delimiters).

import { launch, seedJournal, check, done, APP, API } from './lib.mjs'

const browser = await launch()
const blocksOf = async (date) => Object.values((await (await fetch(`${API}/journals/${date}`)).json()).blocks)

async function newPage(date, tree, expectText) {
  await seedJournal(date, tree)
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } })
  await page.addInitScript(() => localStorage.setItem('tend-settings', JSON.stringify({ state: { useLegacyEditor: false }, version: 1 })))
  await page.goto(`${APP}/journal/${date}`, { waitUntil: 'networkidle' })
  await page.waitForFunction((t) => document.body.innerText.includes(t), expectText, { timeout: 15000 })
  return page
}

try {
  // --- Slash menu ---
  {
    const DATE = '2099-09-01'
    const page = await newPage(DATE, [{ content: 'hello' }], 'hello')

    await page.getByText('hello', { exact: false }).first().click()
    await page.keyboard.press('Home')
    await page.keyboard.type('/', { delay: 20 })
    await page.waitForSelector('.slash-menu', { timeout: 3000 })
    check('slash: menu opens on "/"', await page.locator('.slash-menu').count() > 0)

    await page.keyboard.type('h1', { delay: 20 })
    await page.waitForTimeout(200)
    const rows = await page.locator('.slash-menu button').allInnerTexts()
    check('slash: query filters to Heading 1', rows.length === 1 && rows[0].includes('Heading 1'))

    const before = (await blocksOf(DATE)).length
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1500)
    const bs = await blocksOf(DATE)
    check('slash: Enter did NOT split the block', bs.length === before && bs.length === 1)
    check(`slash: "/h1" replaced by "# " (got ${JSON.stringify(bs[0].content)})`, bs[0].content === '# hello')
    check('slash: menu closed after select', await page.locator('.slash-menu').count() === 0)
    await page.close()
  }

  // --- Formatting keybind ---
  {
    const DATE = '2099-09-02'
    const page = await newPage(DATE, [{ content: 'world' }], 'world')

    // Double-click selects the word, then Ctrl+B wraps it.
    await page.getByText('world', { exact: false }).first().dblclick()
    await page.keyboard.press('Control+b')
    await page.waitForTimeout(1500)
    const bs = await blocksOf(DATE)
    check(`format: Ctrl+B wrapped selection (got ${JSON.stringify(bs[0].content)})`, bs[0].content === '**world**')
    check('format: still one block', bs.length === 1)
    await page.close()
  }
} finally {
  await browser.close()
}
done()
