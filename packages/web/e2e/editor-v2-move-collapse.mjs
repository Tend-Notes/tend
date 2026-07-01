// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Editor V2: Alt+ArrowUp moves a block among siblings; clicking a block's bullet
// (fold) toggles collapse and persists it.

import { launch, seedJournal, check, done, APP, API } from './lib.mjs'

const DATE = '2099-08-08'
await seedJournal(DATE, [
  { content: 'alpha', children: [{ content: 'child1' }] },
  { content: 'beta' },
  { content: 'gamma' },
])

const browser = await launch()
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  await page.addInitScript(() => localStorage.setItem('tend-settings', JSON.stringify({ state: { useLegacyEditor: false }, version: 1 })))
  await page.goto(`${APP}/journal/${DATE}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.body.innerText.includes('gamma'), { timeout: 15000 })

  const rootOrder = async () => {
    const p = await (await fetch(`${API}/journals/${DATE}`)).json()
    return p.rootBlocks.map((u) => p.blocks[u].content)
  }
  const collapsedOf = async (c) => {
    const p = await (await fetch(`${API}/journals/${DATE}`)).json()
    return Object.values(p.blocks).find((b) => b.content === c)?.collapsed
  }

  // Alt+ArrowUp on beta -> [beta, alpha, gamma]
  await page.getByText('beta', { exact: false }).first().click()
  await page.keyboard.press('Alt+ArrowUp')
  await page.waitForTimeout(1500)
  check('Alt+ArrowUp moved beta above alpha', JSON.stringify(await rootOrder()) === JSON.stringify(['beta', 'alpha', 'gamma']))

  // Click alpha's bullet -> collapsed, children hidden, persisted.
  await page.evaluate(() => {
    const li = [...document.querySelectorAll('.outline2 .block-container')].find((e) => e.querySelector('.block-content')?.textContent === 'alpha')
    li.querySelector('.block-fold').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  })
  await page.waitForTimeout(300)
  const dom = await page.evaluate(() => {
    const li = [...document.querySelectorAll('.outline2 .block-container')].find((e) => e.querySelector('.block-content')?.textContent === 'alpha')
    return { collapsed: li.getAttribute('data-collapsed'), hidden: getComputedStyle(li.querySelector('ul.block-list')).display === 'none' }
  })
  check('bullet click collapsed alpha (DOM) + hid children', dom.collapsed === 'true' && dom.hidden)
  await page.waitForTimeout(1500)
  check('collapse persisted to model', (await collapsedOf('alpha')) === true)
} finally {
  await browser.close()
}
done()
