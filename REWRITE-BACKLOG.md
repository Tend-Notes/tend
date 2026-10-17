# Rewrite backlog

Work deliberately deferred to the next major rewrite. Not bugs — things whose
right shape needs more room than an incremental change gives.

## 1. A properly encrypted search index

Today an encrypted garden's full-text index is plaintext: built in RAM on
unlock (`crates/tend-server/src/state.rs`, `SearchIndex::in_memory`) and never
written to disk. That keeps it off the filesystem but leaves a searchable copy
of every note resident for as long as the garden is unlocked — which is what
the orange lock badge in the page title row reports, and what the 12-hour idle
TTL now bounds.

Replace it with a tantivy `Directory` implementation that encrypts in
fixed-size blocks (XChaCha20 or AES-CTR, nonce from file id + block offset, key
derived from the garden's existing age identity in `.tend/identity.age`). Only
the blocks a query touches get decrypted, so random access survives — the same
approach SQLCipher takes per SQLite page. The naive alternative (age-encrypt
the whole index directory, decrypt on unlock) means a full decrypt per unlock
and a full re-encrypt per flush, and is not worth doing.

Design for:
- No `MmapDirectory`, so a read-through block cache is needed.
- The `Directory` trait's atomic writes, lock files and watch callback all have
  to be right; this is correctness-sensitive work.
- File sizes and segment counts still leak, even encrypted.

Payoff: an encrypted garden with search on would stay grey rather than orange,
the idle TTL becomes defence in depth rather than the only protection, and the
full decrypt-every-note index rebuild on unlock goes away (the index could then
survive a restart).

Worth considering as a cheaper middle step: keep the RAM index exactly as it is
but persist an encrypted snapshot on lock/shutdown. No per-query crypto and no
custom `Directory` — it buys a fast unlock and restart survival, but does
nothing about the in-memory exposure.

## 2. Touch the sheet when the command palette creates a link to it — DONE

Implemented 2026-10-17: both `onCreate` call sites in `CommandPalette.tsx` now
create the sheet (via `createAndInsertLink`) as the link is inserted, matching
what the compilation level already did. Creating deliberately does not record a
recent-sheet access — the sidebar's recents are a visit log — and the link is
inserted whether or not the create succeeds, so a failure falls back to the old
create-on-visit behaviour. Covered by `e2e/palette-eager-create.mjs` and an
added check in `e2e/compilations.mjs`.

Still deliberately **not** done for `[[links]]` typed by hand in the editor:
those stay unresolved until visited, which is what the missing-link styling
(`--color-link-missing`) and the wikilink autocomplete depend on.
