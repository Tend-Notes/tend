// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Locked garden: an encrypted garden only stays open in the server's memory,
// so a restart leaves it locked and every API call answers 423
// UNLOCK_REQUIRED. That must bring up the passphrase prompt — it used to be a
// 500 rendered as the raw text "500: UNLOCK_REQUIRED:default", with no way to
// unlock, because the unlock route needed the very state that could not be
// built without the passphrase.
//
// The 423s are faked here rather than by restarting the backend: the point of
// the check is what the client does with that answer.

import { launch, APP, check, done } from './lib.mjs'

const LOCKED_BODY = JSON.stringify({
  error: 'This garden is encrypted. Please provide passphrase to unlock.',
  code: 'UNLOCK_REQUIRED',
  gardenId: 'secret',
})

const browser = await launch()

// --- Cold load with the active garden locked ---------------------------
{
  const page = await browser.newPage()
  // whoami still answers: the session is fine, it is the garden that is shut.
  await page.route('**/api/v1/**', (route) => {
    if (route.request().url().includes('/whoami')) return route.continue()
    return route.fulfill({ status: 423, contentType: 'application/json', body: LOCKED_BODY })
  })

  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  const prompt = page.getByRole('heading', { name: 'Unlock Encrypted Garden' })
  await prompt.waitFor({ timeout: 10000 }).catch(() => {})

  check('locked garden: passphrase prompt is shown', await prompt.isVisible().catch(() => false))
  check(
    'locked garden: passphrase field is offered',
    await page.getByLabel('Passphrase').isVisible().catch(() => false)
  )
  check(
    'locked garden: the raw server sentinel is never shown',
    !(await page.content()).includes('UNLOCK_REQUIRED:')
  )
  check(
    'locked garden: no misleading session-expired dialog',
    !(await page.getByRole('heading', { name: 'Session expired' }).isVisible().catch(() => false))
  )
  await page.close()
}

// --- A wrong passphrase reports back and keeps the prompt up -----------
{
  const page = await browser.newPage()
  await page.route('**/api/v1/**', (route) => {
    const url = route.request().url()
    if (url.includes('/whoami')) return route.continue()
    if (url.includes('/gardens/unlock')) {
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"error":"Invalid passphrase"}',
      })
    }
    return route.fulfill({ status: 423, contentType: 'application/json', body: LOCKED_BODY })
  })

  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  const prompt = page.getByRole('heading', { name: 'Unlock Encrypted Garden' })
  await prompt.waitFor({ timeout: 10000 }).catch(() => {})

  await page.getByLabel('Passphrase').fill('not-the-passphrase')
  await page.getByRole('button', { name: /^Unlock$/ }).click()

  const alert = page.getByRole('alert')
  await alert.waitFor({ timeout: 5000 }).catch(() => {})
  check('wrong passphrase: says so', /invalid passphrase/i.test((await alert.textContent().catch(() => '')) ?? ''))
  check('wrong passphrase: prompt stays up', await prompt.isVisible().catch(() => false))
  await page.close()
}

// --- Unlocking reloads the app against the open garden -----------------
{
  const page = await browser.newPage()
  let unlockRequest = null
  await page.route('**/api/v1/**', (route) => {
    const url = route.request().url()
    if (url.includes('/whoami')) return route.continue()
    if (url.includes('/gardens/unlock')) {
      unlockRequest = JSON.parse(route.request().postData() ?? '{}')
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"active":"secret","message":"Garden unlocked and switched successfully."}',
      })
    }
    return route.fulfill({ status: 423, contentType: 'application/json', body: LOCKED_BODY })
  })

  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Unlock Encrypted Garden' }).waitFor({ timeout: 10000 }).catch(() => {})

  // A full navigation is what re-runs startup against the now-open garden.
  await page.evaluate(() => {
    window.__stillTheSameDocument = true
  })
  await page.getByLabel('Passphrase').fill('correct-horse-battery-staple')
  await page.getByRole('button', { name: /^Unlock$/ }).click()
  await page.waitForTimeout(2000)

  check('unlock: sends the id the server reported as locked', unlockRequest?.id === 'secret')
  check('unlock: sends the typed passphrase', unlockRequest?.passphrase === 'correct-horse-battery-staple')
  check(
    'unlock: reloads the app',
    !(await page.evaluate(() => window.__stillTheSameDocument === true))
  )
  await page.close()
}

await browser.close()
done()
