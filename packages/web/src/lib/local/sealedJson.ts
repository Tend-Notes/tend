// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Sealing a value to a garden's own encryption.
//
// Some things Tend persists outside the garden folder are note content by any
// honest reading: the block text of an unsaved draft, and the bytes of a write
// still waiting to land. Storing those in the clear would undo the point of an
// encrypted garden, so they are sealed the same way its note files are —
// encrypted to the garden's X25519 recipient.
//
// Two properties make this work without a passphrase in hand:
//
//   - the recipient is a *public* key, so sealing needs nothing secret, and a
//     draft can be written at any point while the garden is open;
//   - opening needs the identity, which exists only while unlocked, so at rest
//     the exposure is identical to that of the notes themselves.
//
// The consequence is deliberate: a sealed draft is recoverable only after the
// next unlock. That is also where recovery belongs, since the user cannot act
// on a recovered draft in a locked garden.

import { loadWasm } from '../wasm'

/** Seal a JSON-serializable value to a garden's recipient. */
export async function sealTo(recipient: string, value: unknown): Promise<Uint8Array> {
  const wasm = await loadWasm()
  return wasm.encrypt_to_recipient(JSON.stringify(value), recipient)
}

/** Open a sealed value with the garden's identity. */
export async function openWith<T>(identity: string, sealed: Uint8Array): Promise<T> {
  const wasm = await loadWasm()
  return JSON.parse(wasm.decrypt_with_identity(sealed, identity)) as T
}

/** The recipient a garden's identity seals to. */
export async function recipientOf(identity: string): Promise<string> {
  const wasm = await loadWasm()
  return wasm.identity_to_recipient(identity)
}
