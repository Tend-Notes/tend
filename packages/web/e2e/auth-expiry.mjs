// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Auth expiry: an expired reverse-proxy session must produce the "Session
// expired" dialog, not an endless "Loading..." spinner. Before this check
// existed, a 401 from /whoami left pageStore.initialized false forever.

import { launch, APP, check, done } from './lib.mjs'

const browser = await launch()

// --- Cold load with an expired session ---------------------------------
{
  const page = await browser.newPage()
  await page.route('**/api/v1/whoami', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Authentication required"}' })
  )

  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  // Target the dialog heading specifically: the page's own error area can also
  // read "Session expired" behind the overlay.
  const overlay = page.getByRole('heading', { name: 'Session expired' })
  await overlay.waitFor({ timeout: 10000 }).catch(() => {})

  check('cold load: session expired dialog is shown', await overlay.isVisible().catch(() => false))
  const signIn = page.getByRole('button', { name: /sign in again/i })
  check('cold load: sign-in button is offered', await signIn.isVisible().catch(() => false))

  // The button must trigger a real navigation - that is what makes the proxy
  // hand back its login redirect, and the only escape route in an installed app.
  await page.evaluate(() => {
    window.__stillTheSameDocument = true
  })
  await signIn.click()
  await page.waitForTimeout(2000)
  const sameDocument = await page.evaluate(() => window.__stillTheSameDocument === true)
  check('cold load: sign-in performs a full navigation', !sameDocument)
  await page.close()
}

// --- Waking the app after a long sleep re-checks the session ------------
{
  const page = await browser.newPage()
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)

  await page.route('**/api/v1/whoami', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Authentication required"}' })
  )

  // iOS restores a backgrounded app from the bfcache, which fires pageshow.
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
  })

  const overlay = page.getByRole('heading', { name: 'Session expired' })
  await overlay.waitFor({ timeout: 10000 }).catch(() => {})
  check('wake from background: session is re-checked', await overlay.isVisible().catch(() => false))
  await page.close()
}

// --- Non-auth whoami failure must still initialize the app -------------
{
  const page = await browser.newPage()
  await page.route('**/api/v1/whoami', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
  )

  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  // Give the app a moment to run its init chain.
  await page.waitForTimeout(3000)

  const stuckLoading = await page.getByText('Loading...', { exact: true }).isVisible().catch(() => false)
  check('server error: app does not hang on the Loading spinner', !stuckLoading)
  check(
    'server error: no misleading session-expired dialog',
    !(await page.getByRole('heading', { name: 'Session expired' }).isVisible().catch(() => false))
  )
  await page.close()
}

// --- A 401 on a page fetch after load ----------------------------------
{
  const page = await browser.newPage()
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)

  // Session lapses now: every subsequent API call 401s.
  await page.route('**/api/v1/**', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Authentication required"}' })
  )

  // Any navigation triggers a fetch.
  await page.evaluate(() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    const iso = d.toISOString().slice(0, 10)
    window.history.pushState(null, '', `/journal/${iso}`)
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  })

  // Target the dialog heading specifically: the page's own error area can also
  // read "Session expired" behind the overlay.
  const overlay = page.getByRole('heading', { name: 'Session expired' })
  await overlay.waitFor({ timeout: 10000 }).catch(() => {})
  check('mid-session 401: session expired dialog is shown', await overlay.isVisible().catch(() => false))
  await page.close()
}

await browser.close()
done()
