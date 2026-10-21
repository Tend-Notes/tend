// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// The compiled wasm module, exercised the way the browser will use it.
//
// crates/tend-wasm/tests/interop.rs already proves the bridge agrees with the
// server when both run as native Rust. What it cannot prove is that the
// *compiled wasm* behaves the same — different backend, 32-bit pointers, and
// the browser's crypto for randomness. That is this file's job, and it checks
// against fixtures the Rust suite wrote rather than against itself.
//
// Needs `make wasm`; without it the suite says so plainly instead of failing
// with a confusing module-not-found.

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const wasmPath = fileURLToPath(new URL('./generated/tend_wasm_bg.wasm', import.meta.url))
const built = existsSync(wasmPath)

const FIXTURES = fileURLToPath(
  new URL('../../../../../crates/tend-wasm/tests/fixtures/', import.meta.url)
)

describe.skipIf(!built)('tend-wasm bridge (compiled)', () => {
  let wasm: typeof import('./generated/tend_wasm.js')

  beforeAll(async () => {
    const mod = await import('./generated/tend_wasm.js')
    await mod.default({ module_or_path: readFileSync(wasmPath) })
    wasm = mod
  })

  describe('filename encoding', () => {
    // The same table the Rust tests use. Unicode matters: decoding used to map
    // bytes to chars, which mangled anything multi-byte.
    const cases: [string, string][] = [
      ['My Page', 'My Page'],
      ['1:1 Jamie Parker', '1%3A1 Jamie Parker'],
      ['100% Done', '100%25 Done'],
      ['Q&A: "Test"', 'Q&A%3A %22Test%22'],
      ['ünïcode — dash', 'ünïcode — dash'],
      ['日本語のページ', '日本語のページ'],
      ['emoji 🌱 garden', 'emoji 🌱 garden'],
    ]

    it.each(cases)('encodes %j', (name, encoded) => {
      expect(wasm.encode_filename(name)).toBe(encoded)
    })

    it.each(cases)('round-trips %j', (name) => {
      expect(wasm.decode_filename(wasm.encode_filename(name))).toBe(name)
    })

    it('rejects names that escape the garden', () => {
      expect(() => wasm.validate_safe_name('../../etc/passwd')).toThrow()
      expect(() => wasm.validate_safe_name('/absolute')).toThrow()
      expect(() => wasm.validate_safe_name('')).toThrow()
      expect(() => wasm.validate_safe_name('ordinary name')).not.toThrow()
    })
  })

  describe('markdown format', () => {
    it('reproduces a file the server wrote, byte for byte', () => {
      const markdown = readFileSync(`${FIXTURES}page.md`, 'utf8')
      const pageJson = readFileSync(`${FIXTURES}page.json`, 'utf8')

      expect(wasm.serialize_page(pageJson)).toBe(markdown)
    })

    it('parses a server-written file and re-serializes it unchanged', () => {
      const markdown = readFileSync(`${FIXTURES}page.md`, 'utf8')
      const parsed = wasm.parse_markdown(markdown, 'Fixture Page')

      expect(wasm.serialize_page(parsed)).toBe(markdown)
    })

    it('keeps block structure through a parse', () => {
      const markdown = readFileSync(`${FIXTURES}page.md`, 'utf8')
      const page = JSON.parse(wasm.parse_markdown(markdown, 'Fixture Page'))

      expect(page.rootBlocks).toHaveLength(1)
      expect(Object.keys(page.blocks)).toHaveLength(2)
      expect(page.version).toBe(7)

      const contents = Object.values(page.blocks).map((b) => (b as { content: string }).content)
      expect(contents).toContain('parent bullet')
      expect(contents.some((c) => c.includes('ünïcode'))).toBe(true)
    })

    it('rejects JSON that is not a page', () => {
      expect(() => wasm.serialize_page('{"nope":true}')).toThrow()
      expect(() => wasm.serialize_page('not json')).toThrow()
    })
  })

  describe('encryption', () => {
    it('decrypts a note the server encrypted', () => {
      // If the wasm age build diverged at all, this is where it shows.
      const identity = readFileSync(`${FIXTURES}identity.txt`, 'utf8').trim()
      const ciphertext = readFileSync(`${FIXTURES}note.md.age`)

      expect(wasm.decrypt_with_identity(ciphertext, identity)).toBe('server-encrypted note body')
    })

    it('unwraps an identity the server wrapped', () => {
      const wrapped = readFileSync(`${FIXTURES}identity.age`)
      const expected = readFileSync(`${FIXTURES}identity.txt`, 'utf8').trim()

      expect(wasm.unwrap_identity(wrapped, 'correct-horse-battery-staple')).toBe(expected)
      expect(() => wasm.unwrap_identity(wrapped, 'wrong')).toThrow()
    })

    it('reads the verify file the server wrote', () => {
      const verify = readFileSync(`${FIXTURES}encryption.verify`)

      expect(wasm.decrypt_scrypt(verify, 'correct-horse-battery-staple')).toBe(
        'tend-encryption-verification'
      )
      expect(() => wasm.decrypt_scrypt(verify, 'wrong')).toThrow()
    })

    it('mints a usable identity from the host crypto', () => {
      // getrandom's web backend is what is really under test: without
      // randomness this throws rather than returning a weak key.
      const identity = wasm.generate_identity()
      expect(identity).toMatch(/^AGE-SECRET-KEY-1/)

      const recipient = wasm.identity_to_recipient(identity)
      expect(recipient).toMatch(/^age1/)

      const ciphertext = wasm.encrypt_to_recipient('round trip', recipient)
      expect(wasm.decrypt_with_identity(ciphertext, identity)).toBe('round trip')
    })

    it('produces real age files', () => {
      const identity = wasm.generate_identity()
      const ciphertext = wasm.encrypt_to_recipient('x', wasm.identity_to_recipient(identity))

      expect(new TextDecoder().decode(ciphertext.slice(0, 21))).toBe('age-encryption.org/v1')
    })

    it('wraps an identity in the shape the server unwraps', () => {
      const identity = wasm.generate_identity()
      const wrapped = wasm.wrap_identity(identity, 'pass phrase')

      expect(new TextDecoder().decode(wrapped.slice(0, 21))).toBe('age-encryption.org/v1')
      expect(wasm.unwrap_identity(wrapped, 'pass phrase')).toBe(identity)
    })
  })
})

// The loader the app actually calls. Importing it here also proves Vite can
// resolve the `?url` asset import, which is how the browser fetches the module.
describe.skipIf(!built)('loadWasm', () => {
  it('initializes once and caches the module', async () => {
    const { loadWasm, resetWasmForTests } = await import('./index')
    resetWasmForTests()

    const bytes = readFileSync(wasmPath)
    const first = await loadWasm(bytes)
    const second = await loadWasm(bytes)

    expect(second).toBe(first)
    expect(first.encode_filename('1:1 Jamie Parker')).toBe('1%3A1 Jamie Parker')
  })
})

describe.skipIf(built)('tend-wasm bridge', () => {
  it.skip('not built — run `make wasm` to include these checks', () => {})
})
