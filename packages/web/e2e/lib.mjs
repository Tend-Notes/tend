// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Shared helpers for headless end-to-end checks (Playwright + a nix-built
// Chromium). Run via `scripts/run-e2e.sh`, which sets TEND_E2E_CHROMIUM —
// Playwright's bundled Chromium can't run on NixOS, so we point it at a
// nix-provided binary. Requires the dev servers running (frontend :5173,
// backend :3000).

import { chromium } from 'playwright-core'

export const APP = 'http://localhost:5173'
export const API = 'http://localhost:3000/api/v1'

export async function launch() {
  const executablePath = process.env.TEND_E2E_CHROMIUM
  if (!executablePath) {
    throw new Error('TEND_E2E_CHROMIUM is not set — run via scripts/run-e2e.sh')
  }
  return chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
}

// Seed a journal via the API. `tree` is an array of {content, children?, collapsed?}.
export async function seedJournal(date, tree) {
  const blocks = []
  const walk = (n, parentUuid) => {
    const uuid = crypto.randomUUID()
    const children = (n.children || []).map((c) => walk(c, uuid))
    blocks.push({
      uuid,
      content: n.content,
      parent_uuid: parentUuid,
      children,
      collapsed: !!n.collapsed,
      properties: {},
    })
    return uuid
  }
  tree.forEach((n) => walk(n, null))
  const res = await fetch(`${API}/journals/${date}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks, version: null }),
  })
  if (!res.ok) throw new Error(`seed failed: HTTP ${res.status}`)
  return res.json()
}

let failed = 0
export function check(label, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`)
  if (!cond) failed++
}
export function done() {
  if (failed) {
    console.error(`\n${failed} check(s) failed`)
    process.exit(1)
  }
  console.log('\nall checks passed')
}
