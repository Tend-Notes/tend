// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Draft scoping and sealing.
//
// The IndexedDB wiring itself is exercised by the e2e check, which runs in a
// real browser and asserts that nothing readable is left at rest. What is
// tested here is the two decisions that wiring depends on: which garden a draft
// belongs to, and that an encrypted garden's drafts are no more readable at
// rest than its notes.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { draftKey, draftScope } from './draftStore'
import { resetBackendForTests, setActiveBackend } from './backend'

const wasmPath = fileURLToPath(new URL('./wasm/generated/tend_wasm_bg.wasm', import.meta.url))
const built = existsSync(wasmPath)

describe('which garden a draft belongs to', () => {
  beforeEach(() => resetBackendForTests())
  afterEach(() => resetBackendForTests())

  it('separates two local gardens, and both from the server', () => {
    expect(draftScope()).toBe('server')

    setActiveBackend({ kind: 'local', gardenId: 'work' })
    expect(draftScope()).toBe('local:work')

    setActiveBackend({ kind: 'local', gardenId: 'personal' })
    expect(draftScope()).toBe('local:personal')

    setActiveBackend({ kind: 'demo' })
    expect(draftScope()).toBe('demo')
  })

  it('gives the same page name a different key per garden', () => {
    // The bug this closes: keyed on the page name alone, a draft for
    // "Shopping" in a local garden and one in a server garden were one record.
    const keys = new Set([
      draftKey('server', 'Shopping'),
      draftKey('local:work', 'Shopping'),
      draftKey('local:personal', 'Shopping'),
      draftKey('demo', 'Shopping'),
    ])
    expect(keys.size).toBe(4)
  })

  it('cannot be confused by a page name containing the separator character', () => {
    // The key joins on NUL, which a page name cannot contain — a filename
    // cannot either, and `validate_safe_name` rejects control characters.
    expect(draftKey('server', 'a')).not.toBe(draftKey('server', 'a\u0000b'))
  })
})

describe.skipIf(!built)('sealing a draft to the garden', () => {
  it('seals so that only the garden can read it back', async () => {
    const { loadWasm } = await import('./wasm')
    const wasm = await loadWasm(readFileSync(wasmPath))
    const { openWith, recipientOf, sealTo } = await import('./local/sealedJson')

    const identity = wasm.generate_identity()
    const recipient = await recipientOf(identity)

    const draft = {
      blocks: [{ uuid: 'u1', content: 'the thing I did not want on disk' }],
      rootBlocks: ['u1'],
    }
    const sealed = await sealTo(recipient, draft)

    // What is at rest is an age file, and the body is not in it.
    const asText = new TextDecoder().decode(sealed)
    expect(asText).toContain('age-encryption.org')
    expect(asText).not.toContain('did not want on disk')

    expect(await openWith(identity, sealed)).toEqual(draft)
  })

  it('cannot be opened by another garden', async () => {
    const { loadWasm } = await import('./wasm')
    const wasm = await loadWasm(readFileSync(wasmPath))
    const { openWith, recipientOf, sealTo } = await import('./local/sealedJson')

    const sealed = await sealTo(await recipientOf(wasm.generate_identity()), { a: 1 })
    await expect(openWith(wasm.generate_identity(), sealed)).rejects.toThrow()
  })

  it('needs no secret to seal, so a draft can be written any time the garden is open', async () => {
    // The recipient is a public key: this is what lets a draft be sealed
    // without a passphrase in hand, while still being unreadable at rest.
    const { loadWasm } = await import('./wasm')
    const wasm = await loadWasm(readFileSync(wasmPath))
    const { recipientOf, sealTo } = await import('./local/sealedJson')

    const recipient = await recipientOf(wasm.generate_identity())
    expect(recipient.startsWith('age1')).toBe(true)
    await expect(sealTo(recipient, { a: 1 })).resolves.toBeInstanceOf(Uint8Array)
  })
})
