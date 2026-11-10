// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Is the committed wasm bridge still the one these sources produce?
//
// The bridge's build output is committed, because the frontend imports it
// statically and nothing in the Docker, nix or CI build can produce it — none
// of them has a Rust toolchain with the wasm32 target and a `wasm-bindgen-cli`
// pinned to the exact version in Cargo.lock.
//
// That trades one failure mode for another. The old one was a build that could
// not resolve the import; this one is an artifact that silently lags the Rust
// it was built from, so the browser runs last week's parser while the server
// runs this week's. This check closes it without needing the toolchain: the
// build script stamps a hash of the crates that feed the bridge, and this
// recomputes it.
//
// If this fails, run `make wasm` and commit the result.

import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url))
const STAMP = join(REPO, 'packages/web/src/lib/wasm/generated/SOURCE')

/** The crates whose source ends up inside the bridge. */
const CRATES = [
  'crates/tend-wasm/src',
  'crates/tend-core/src',
  'crates/tend-storage/src',
  'crates/tend-index/src',
]

function rustFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...rustFiles(path))
    else if (entry.endsWith('.rs')) out.push(path)
  }
  return out
}

/** The wasm-bindgen version Cargo.lock pins, which the CLI must match. */
function wasmBindgenVersion(): string {
  const lock = readFileSync(join(REPO, 'Cargo.lock'), 'utf8')
  const at = lock.indexOf('name = "wasm-bindgen"')
  const version = /version = "([^"]+)"/.exec(lock.slice(at))
  if (!version) throw new Error('wasm-bindgen not found in Cargo.lock')
  return version[1]
}

/**
 * The same hash `scripts/build-wasm.sh` writes: the wasm-bindgen version, then
 * `sha256sum` output for every Rust file, byte-sorted by path.
 */
function expectedStamp(): string {
  const lines = [`wasm-bindgen ${wasmBindgenVersion()}\n`]
  const paths = CRATES.flatMap((c) => rustFiles(join(REPO, c)))
    .map((p) => p.slice(REPO.length))
    .sort()
  for (const path of paths) {
    const digest = createHash('sha256').update(readFileSync(join(REPO, path))).digest('hex')
    lines.push(`${digest}  ${path}\n`)
  }
  return createHash('sha256').update(lines.join('')).digest('hex')
}

describe('the committed wasm bridge', () => {
  it('exists, because every build path imports it and none can build it', () => {
    const dir = join(REPO, 'packages/web/src/lib/wasm/generated')
    for (const file of ['tend_wasm.js', 'tend_wasm_bg.wasm', 'SOURCE']) {
      expect(existsSync(join(dir, file)), `${file} is missing — run \`make wasm\``).toBe(true)
    }
  })

  it('was built from the Rust that is checked in', () => {
    const stamped = readFileSync(STAMP, 'utf8').trim()
    expect(
      stamped,
      'The committed wasm bridge is older than the Rust it comes from, so the ' +
        'browser and the server would disagree about the file format. Run ' +
        '`make wasm` and commit the result.'
    ).toBe(expectedStamp())
  })
})
