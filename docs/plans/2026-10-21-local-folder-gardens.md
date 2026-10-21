# Local-Folder Gardens Implementation Plan

**Status:** approved, not started. No implementation code exists yet — the
environment for building it is unsettled (see *Environment*), so nothing in this
document has been executed or verified.

**Goal:** Let a garden's files live in a folder on the user's own machine,
chosen through the browser's directory picker, instead of in the server's garden
directory — so sensitive work notes can sit on a work laptop and never reach the
server. Works for both unencrypted and encrypted gardens.

**Architecture:** Compile the existing Rust format and encryption code to
WebAssembly and call it from the browser, so the folder is byte-identical to a
server garden by construction. The API layer gains a runtime, per-active-garden
backend selector; a local backend implements that API surface over a
`FileSystemDirectoryHandle`.

**Tech Stack:** Rust (wasm-bindgen, age), TypeScript (React/Zustand), File
System Access API. Target browser: Edge only.

---

## Context

A garden today is a directory the server owns. The requirement is a garden whose
files the server never sees, while the folder remains an ordinary Tend garden:
`tend-server` can be pointed at it, and `age -d` still decrypts its files. That
single requirement drives the main architectural choice below — everything else
follows from it.

Non-goals, restated from the brief: no Safari/Firefox/iOS, no OPFS, no sync or
merge between local and server gardens, no change to existing server gardens.

---

## Why WebAssembly, and not a TypeScript port

The on-disk format is produced by roughly a thousand lines of Rust:

- `crates/tend-core/src/serializer.rs` — `serialize_page`, page properties,
  bullet indentation, the longform special case
- `crates/tend-core/src/parser.rs` — `parse_markdown`
- `crates/tend-core/src/block_metadata.rs` — the `<!-- tend:blocks` footer
  (`FOOTER_START`, `FOOTER_WARNING`, `FOOTER_HEADER`, `serialize_footer`)
- `crates/tend-core/src/name.rs` — `qualify`, `split`
- `crates/tend-storage/src/fs.rs` — `encode_filename` / `decode_filename`
- `crates/tend-storage/src/encryption.rs` — the age scheme

Hand-porting that to TypeScript duplicates every subtlety and guarantees drift:
each future format change would have to be made twice, correctly, forever. Hard
requirement 1 would then rest on vigilance.

Instead, a new crate `crates/tend-wasm` exposes those *existing* functions
through `wasm-bindgen`. The browser runs the same code the server does.

Exported surface — thin wrappers only, no logic in this crate:

| Export | Wraps |
| --- | --- |
| `serialize_page(json) -> String` | `tend_core::serialize_page` |
| `parse_markdown(text, name) -> json` | `tend_core::parse_markdown` |
| `qualify_name`, `split_name` | `tend_core::name` |
| `encode_filename`, `decode_filename` | `tend_storage::fs` |
| `generate_identity`, `wrap_identity`, `unwrap_identity` | `tend_storage::encryption` |
| `encrypt_to_recipient`, `decrypt_with_identity` | `tend_storage::encryption` |
| `encrypt_scrypt`, `decrypt_scrypt` | `encryption::encrypt` / `decrypt` |

The JSON boundary uses the `Page`/`Block` shapes serde already emits, which
`packages/web/src/types` already mirrors.

**The first thing to check, and the plan's main risk:** that `age` (x25519 +
scrypt) and `getrandom` build for `wasm32-unknown-unknown` with the `js`
feature; the resulting bundle size; and scrypt's speed in wasm. Scrypt runs once
per unlock, so a second or two is acceptable — per-file it would not be, which is
exactly why the server moved to a per-garden X25519 identity. If age cannot
build for wasm, the fallback is `age-encryption` (typage) on npm for the age
layer only, keeping wasm for the format; that swap touches one module.

---

## Encryption: identical to the server

Per garden: a random X25519 identity, its secret wrapped once with age-scrypt at
`.tend/identity.age`; note files encrypted to the X25519 recipient (no per-file
KDF); `.tend/encryption.verify` holding age-scrypt ciphertext of the literal
`tend-encryption-verification`; files at `pages/<encoded>.md.age` and
`journals/<date>.md.age`.

Creation order on a fresh encrypted local garden mirrors the server exactly —
`routes/gardens.rs:481-493` then `encrypted_fs.rs:102-140`: write the verify
file first, then mint and wrap the identity. Unlock unwraps the identity, which
*is* the passphrase check, as on the server.

### No plaintext at rest

IndexedDB holds exactly two things: the `FileSystemDirectoryHandle` (not a
secret) and the local-garden registry (id, name, encrypted flag, created-at).

The unwrapped identity, decrypted notes, and any derived search/link/tag index
live in memory only, and are dropped on lock, on garden switch, and on page
unload. The passphrase is never persisted. Filenames remain the one at-rest
exposure, as on the server.

One non-obvious leak to close: `lib/userSync.ts` syncs UI state to the server,
and `recentSheets` carries sheet names and titles — for a local garden, note
titles leaving the machine. Local-garden entries are excluded from the synced
payload and kept in `localStorage` only.

---

## Runtime backend selection

`lib/api.ts` currently picks an implementation at module load:

```ts
export const pages = isDemoMode ? demoApi.pages : _pages
```

That is a build-time switch on `VITE_DEMO_MODE`. A local garden needs the choice
per *active garden*, at runtime.

`lib/backend.ts` owns `BackendKind = 'server' | 'demo' | 'local'` and a
`setActiveBackend()` the garden switch calls. Each API group in `api.ts` becomes
a dispatcher over the resolved backend. Every API function already returns a
promise, so a dispatcher can `await` a dynamically imported module — which keeps
`demoApi` and the local backend out of the main chunk, as the build-time ternary
does today.

Cost to demo mode: `VITE_DEMO_MODE` seeds the initial backend instead of
swapping the exports. Behaviour is unchanged, and the demo click-through check
still covers it.

---

## Server-only features in a local garden

Each answered explicitly; silent breakage is not acceptable.

| Feature | Behaviour | UI |
| --- | --- | --- |
| Full-text search | Client index built in memory from parsed files on first search; dropped on lock/switch — the same posture as an encrypted server garden | Search works; the lock badge legend already describes the in-memory index |
| Git backup / history | Unavailable; the server owns the repo | Git panel replaced with "Not available for a local folder garden" |
| Reindex | No-op — indices are already in memory | Button hidden |
| Stabilize | Runs client-side over the folder | Kept |
| File watcher | No events; the File System Access API has none | Manual "Reload from disk", plus the staleness check below |
| WebSocket sync | Not subscribed; the server has nothing to say about this garden | No UI change; the connection stays up for server gardens |

---

## Durability and concurrency

Single writer assumed: this browser profile. Writes go through
`createWritable()`, which writes to a swap file and commits on `close()`, so a
crash mid-write leaves the previous file intact.

Staleness is detected, not prevented. Every read records the file's
`lastModified`; a write re-stats the file first, and a mismatch means another
program edited it. The write is then refused with the existing
`VersionConflictError`, which `pageStore` and `ConflictResolutionDialog` already
handle for server version conflicts. No merge is attempted.

---

## Permissions and the missing-folder path

On load, each local garden's saved handle is checked with `queryPermission`.
Already-granted is rare after a browser restart, so the normal path is a
"Reconnect <folder>" button calling `requestPermission()` from that click — a
user gesture is required, so silent re-grant is not an option.

A handle whose folder was moved or deleted surfaces as "That folder is gone —
pick it again, or remove this garden", with a picker to re-point it. The
registry entry keeps its id, so the garden's identity survives a re-point.

---

## Garden list and the other-machine case

Local gardens appear in the same switcher as server gardens, listed after them,
each with a folder badge and its directory name. They come from the client
registry rather than `GET /gardens`, merged in `SidebarOptions`.

Opening Tend from another machine simply does not show them — the registry and
the handle are per browser profile. Stated once in the sidebar's local-garden
section ("Local gardens live in this browser on this machine"), not raised as an
error: there is nothing to recover.

---

## Hosting

Both deployments work. An HTTPS Tend instance and `http://localhost` are both
secure contexts, which is all the File System Access API requires. The folder is
read and written entirely in the page: the server never receives a path, a
handle, or any content, and nothing in the feature needs same-origin access to
the folder's contents.

---

## Increments

Each ends with `make test` and the real runner output pasted into the working
notes before the next one starts. A red run halts forward progress.

### Task 1: Makefile + `crates/tend-wasm` skeleton

**Files:** create `Makefile`, `crates/tend-wasm/{Cargo.toml,src/lib.rs}`; modify
`Cargo.toml` (workspace members), `flake.nix` (wasm toolchain).

The repo has no `Makefile`; the brief assumes `make test`. It wraps
`cargo test --workspace`, `pnpm --filter web test`, and `scripts/run-e2e.sh`.

One export (`serialize_page`) wired through to the web build. The point is to
prove the toolchain before anything depends on it.

### Task 2: Golden-file interop corpus

**Files:** create `crates/tend-wasm/tests/golden.rs`,
`packages/web/src/lib/garden-format/interop.test.ts`, fixtures under
`crates/tend-wasm/tests/fixtures/`.

Rust tests write fixtures: plain and encrypted, with and without footers,
unicode names, names needing `encode_filename`, a longform page. A vitest suite
loads the wasm module and asserts byte-equality in both directions.

This is the evidence for hard requirement 1, and it fails loudly if either side
drifts.

### Task 3: age in wasm

**Files:** modify `crates/tend-wasm/src/lib.rs`, extend the corpus.

Identity generation, wrap/unwrap, encrypt/decrypt to recipient, verify file.
Plus a Rust test that decrypts wasm-produced files, and a scripted `age -d`
check where the CLI is available.

### Task 4: `LocalFolderStore`

**Files:** create `packages/web/src/lib/local/LocalFolderStore.ts`,
`packages/web/src/lib/local/handleFake.ts` (test double), and their tests.

Handle plumbing: directory traversal, read, write via `createWritable`, delete,
list, `lastModified` capture, permission query and request. Unit-tested against
an in-memory `FileSystemDirectoryHandle` fake — also what the e2e checks use,
since the real picker cannot be automated.

### Task 5: `localBackend`

**Files:** create `packages/web/src/lib/local/localBackend.ts`.

The API groups over the store plus wasm: pages, journals, sheets, templates,
content types; links/tags/todos/graph derived in memory; search over the
in-memory index.

### Task 6: Backend resolver

**Files:** create `packages/web/src/lib/backend.ts`; modify
`packages/web/src/lib/api.ts`.

The dispatchers, and demo mode moved onto the new path.

### Task 7: Registry and UI

**Files:** create `packages/web/src/lib/local/registry.ts`,
`packages/web/src/stores/localGardenStore.ts`; modify
`packages/web/src/components/sidebar/SidebarOptions.tsx`,
`packages/web/src/lib/userSync.ts`.

IndexedDB registry, create/pick/unlock/reconnect flows, merged switcher, feature
gating copy, the `userSync` exclusion.

### Task 8: e2e

**Files:** create `packages/web/e2e/local-folder-garden.mjs`.

Drives the whole flow against the handle fake: create an encrypted local garden,
write a note, lock, unlock, reconnect, and assert no plaintext in IndexedDB.

---

## Verification

- `make test` after every increment, output pasted, nothing stacked on red.
- Interop both directions as its own suite (Tasks 2-3): Rust writes → wasm
  reads; wasm writes → Rust reads; `age -d` where available.
- Manual, in Edge, once Tasks 4-7 land: create a local garden on disk, point
  `tend-server` at the same folder, confirm it opens and renders identically.
- At-rest check: after unlocking an encrypted local garden and editing a note,
  dump IndexedDB and assert it contains no note text (also asserted in e2e).

---

## Not verified / open

- **`age` + `getrandom` for `wasm32-unknown-unknown`** — buildability, bundle
  size, and scrypt speed in wasm. Tasks 1 and 3 settle this; typage is the
  contingency.
- **Toolchain supply** — whether the nix flake can provide
  `wasm-pack`/`wasm-bindgen-cli`, and what CI needs.
- **Content-type asymmetry** — a local garden's content types live in the client
  registry and are mirrored to `.tend/content-types.json`, but a server pointed
  at the folder reads its own per-user registry instead, so custom types would
  need re-declaring there. Documented, not solved here.
- **Nothing has been built or run.** The sandbox this plan was written in has no
  network, so the wasm target, `wasm-pack`, and npm packages cannot be
  installed. Every claim above is from reading the code, not from execution.

## Environment

Implementation is blocked on one choice: either the installs are run outside the
sandbox and handed back, or the sandbox is given network access. Until then this
document stands alone and no code should be written against it.
