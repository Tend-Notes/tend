# Local-Folder Gardens Implementation Plan

**Status:** in progress on `feat/local-folder-gardens`. Tasks 1-4 are built and
tested (the wasm bridge, its build pipeline, the interop corpus, and
`LocalFolderStore`), as is task 7's data layer (the registry and the gardens
root). Tasks 5, 6 and the task 7 UI are open. Nothing has yet run in a real
browser against a real folder — the picker needs a user gesture, so that waits
on the UI.

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

IndexedDB holds the `FileSystemDirectoryHandle` (not a secret); the local-garden
registry (id, name, encrypted flag, created-at, and for an encrypted garden the
X25519 recipient, which is a public key); and queued writes and drafts, which
for an encrypted garden are encrypted to that recipient rather than stored as
text — see *Queued writes and drafts*. None of it is plaintext note content.

The unwrapped identity, decrypted notes, and any derived search/link/tag index
live in memory only, and are dropped on lock, on garden switch, and on page
unload. The passphrase is never persisted. Filenames remain the one at-rest
exposure, as on the server.

Three channels carry garden content out of the page as the code stands, and all
three are reuse of server-garden machinery that was never re-checked against the
rule above. They are named here rather than buried in the task list, because
closing them is the work, not a detail of it.

**`lib/userSync.ts` sends more than sheet titles.** `buildState()` posts
`recentSheets` (sheet names and titles), `recentTags` and `tags` (tag names),
and `activeWorkSession` — which carries `pageName` *and* `taskContent`, the
literal text of a task block. `flushPendingSaves()` sends the same payload by
`navigator.sendBeacon` on `beforeunload`, so a guard wrapped only around the
debounced path would not cover it.

Filtering that payload down to its content-free fields does not work, and the
reason is worth recording. `POST /user/state` replaces the whole blob, and the
blob is per *user*, not per garden — so a local garden that sent a reduced
payload would overwrite the server garden's `recentSheets`, `tags` and work
session with nothing, destroying real state as a side effect of protecting it.

So the UI-state sync is suspended outright while a local garden is active:
nothing is sent, and the server's stored blob is left exactly as the last server
garden left it. What that costs is sidebar geometry not being written back
during a local session, which is already restored from the server on the next
load — no friction a user would notice.

Preferences are a separate payload and keep syncing: `buildPrefs()` carries
themes, font sizing, task-status vocabulary and git settings, every one of them
a number or a fixed enum, and no garden content. Changing a theme inside a local
garden should stick, and it does.

**`lib/draftStore.ts` is not garden-scoped.** Its key is `pageName` alone, so a
local garden's draft and a server garden's draft for the same sheet name already
overwrite each other today, before encryption comes into it at all. The key
becomes `(backend, gardenId, pageName)`, and the body is encrypted as described
in *Queued writes and drafts*.

**The service worker caches sheet responses to disk.** `vite.config.ts`
runtime-caches `/api/v1/pages` and `/api/v1/journals` into Cache Storage for 24
hours. A local garden never issues those requests, so this is a leak only if
something reaches `fetch()` — which is the second reason the resolver in Task 6
must fail closed rather than fall back to the server implementation. Separately,
and pre-existing: for an *encrypted server* garden that cache already holds
decrypted sheet JSON at rest. Out of scope here, recorded as item 3 of
`REWRITE-BACKLOG.md`.

### Per-garden UI state

Recent sheets, recent tags and tag colours are content — they are names the user
wrote. For a server garden the server holds them; a local garden needs somewhere
else, and `localStorage` is not it, because zustand's `persist` middleware would
write those names to disk in the clear, which is the thing this section forbids.

They live in the garden folder instead: `.tend/ui-state.json` for an unencrypted
garden, and `.tend/ui-state.json.age`, encrypted to the garden's X25519
recipient, for an encrypted one. That is the same mechanism as queued drafts, so
it is the same module and not a second scheme.

This is the lowest-friction option rather than a compromise for safety's sake.
The state survives a reload, and it follows the folder to another machine, which
neither `localStorage` nor IndexedDB does. `.tend/` is already ignored in full by
`tend-git`'s backup — `ensure_gitignore` broadens a narrow ignore to the whole
directory — so there is no commit churn and no path to a remote; that precaution
exists precisely because the link index, carrying plaintext wikilink and tag
names, was committed and pushed before it was tightened. Writes are debounced as
`userSync` already debounces, and the watcher's self-write filter covers them.
For an encrypted garden the file is readable only after unlock, so the sidebar's
recents fill in at unlock and show nothing before it — which is already the
posture of a locked garden.

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
| File watcher | One recursive `FileSystemObserver` on the garden folder — see below | Live reload as on the server; manual "Reload from disk" kept as a fallback |
| WebSocket sync | Not subscribed; the server has nothing to say about this garden | No UI change; the connection stays up for server gardens |

### Watching the folder

An earlier draft of this plan said a local garden cannot have a watcher because
the File System Access API has no change events. That is out of date:
`FileSystemObserver` shipped in Chrome and Edge 133, after an origin trial that
ran from Chrome 129 to 134. Desktop only, which fits the Edge-only target. So a
local garden does get a watcher, and the folder updating under Tend behaves the
way it does for a server garden.

One observer, watching the active garden's directory recursively:

```ts
observer.observe(dir, { recursive: true })
```

Each change record carries a type — `appeared`, `disappeared`, `modified`,
`moved`, `unknown`, `errored` — and `relativePathComponents`. Between them that
is enough to reload exactly the note that was touched, rather than re-reading
the garden on every event.

Two things have to be designed around, and the server already solves both; the
local watcher mirrors its solutions instead of inventing new ones.

First, our own writes fire `modified`, so without a filter every save would
trigger a reload of the note just saved. `tend-storage`'s watcher keeps a
`pending_writes` set (`crates/tend-storage/src/watcher.rs`): the path goes in
before the write and events for it are dropped until it clears.
`LocalFolderStore` holds the same set over the paths it is writing.

Second, a folder on a cloud-synced drive is noisy — one remote change can arrive
as a burst of creates, renames, and modifications. The server debounces with
notify-debouncer-full on a 500ms window; the local watcher needs the equivalent,
coalescing records per path over a short window before acting on them.

Two caveats worth recording now, because both change the design rather than the
implementation. A record of type `unknown` means events were *missed*, not that
something strange happened — the only safe response is to re-read the whole
garden, so that path has to exist. And there is an undocumented per-origin limit
on concurrent observations, which is the second reason to run one recursive
observer at the garden root rather than one per file.

The manual "Reload from disk" stays, but it is now the fallback — for a browser
without the API, or after an `unknown` record — not the mechanism.

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

Reads need a retry for the mirror-image case. The `File` returned by
`getFile()` is a snapshot — path, size, `lastModified` — and the bytes are not
fetched until something actually reads them. If the file changes in between, the
read fails with `NotReadableError` rather than handing back a torn mix of old
and new content. That failure is the behaviour we want: a torn read of a
markdown note is a mangled page, and of an `.age` file an undecryptable blob.
But it still has to be handled. The documented remedy is to call `getFile()`
again, so the store retries once; if the second attempt fails too, it is
classified as the same staleness condition as `StaleWriteError` — "something
else is editing this file" — and reaches the UI by that path, rather than
letting a raw DOM exception escape.

A second failure is most likely a cloud-sync client rewriting the file
underneath us. OneDrive's "Files On-Demand" adds a related wrinkle: an
online-only file is a placeholder that has to be hydrated from the network
before it can be read at all, so a read can be slow, or fail outright when the
machine is offline — and the API gives us no way to tell that apart from the
file being gone.

---

## Queued writes and drafts

A write can fail to proceed for reasons that have nothing to do with the user's
edit: a read retry that did not recover, permission dropped after a browser
restart, the folder temporarily gone because an external drive is unmounted or a
sync client is mid-operation. In none of those cases may the edit be lost.

Transient failures get an in-memory retry queue in `LocalFolderStore`: the write
is held and re-attempted, and the editor keeps going. That is enough for a
failure measured in seconds, and nothing more is needed for it.

Edits that have to survive a page reload need to be persisted, and Tend already
has the machinery — `lib/draftStore.ts` queues unsaved edits in IndexedDB and
offers them back through `DraftRecoveryDialog`. Reusing it is right, but it
opens a leak that has to be closed first: for an *encrypted* local garden, the
draft store as written would put note body text into IndexedDB in the clear.
That is the same class of leak as the `recentSheets`/`userSync` one above, and
worse, because it is the body of the note rather than its title.

The fix uses the garden's own scheme. The X25519 *recipient* is a public key, so
it can be stored persistently without weakening anything, and queued writes and
drafts can be encrypted to it with no passphrase present. They then become
readable only after the next unlock, which means at-rest exposure is identical
to that of the notes themselves, and draft recovery happens after unlock — which
is where it belongs anyway, since the user cannot act on a recovered draft while
the garden is locked.

The limit, stated plainly: queueing preserves work, it does not resolve
conflicts. If the file changed on disk while an edit sat in the queue, applying
that edit is still a decision — overwrite, keep theirs, or reconcile by hand —
and there is no merge logic here any more than there is for a write conflict.

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

## Hostile content in the folder

A local garden inverts the usual trust direction. A note file is ordinary input
from the app's point of view, but anyone — or anything — with write access to
that folder can author it: a synced file from a colleague, malware already on
the machine, or the user pasting something they should not have. Whatever that
file contains is then read into an origin holding the user's session cookie and
the directory handle itself, so a stored-XSS here would inherit both. This is
not a new vector (a server garden's files can be edited on the server too), but
a local garden makes untrusted input routine rather than hypothetical.

What stops it today, in order of how much weight each carries:

- **Note content is never markup.** ProseMirror holds it as text nodes, and the
  decoration layer attaches `class` and `data-*` attributes to ranges of
  existing text (`outline2/decorations.ts`) — it never injects HTML. There is no
  `innerHTML` assignment anywhere in `src`, and no `eval`, `new Function`,
  `<iframe>` or `srcdoc`.
- **URL schemes are filtered.** `lib/safeHref.ts` rejects `javascript:`,
  `data:`, `vbscript:` and `file:`, and every clicked link goes through it
  before `window.open(..., 'noopener,noreferrer')`.
- **CSP is the backstop.** The server sends `script-src 'self'`
  (`crates/tend-server/src/headers.rs`), which blocks inline script and
  `javascript:` URLs even if something reached the DOM.

Two pieces of work follow from this, both small:

The tag-pill decoration builds a `style` attribute by interpolating colour
components (`decorations.ts`). Those come from client state rather than note
content, so a hostile file cannot reach them, but they are not coerced to
numbers — a latent CSS-injection path. No script execution, but it would allow
UI spoofing or a beacon via `url()`. Coerce them.

More importantly, the safety above is currently an *observation* — the editor
happens never to render markup — rather than a stated invariant. It needs a test
that treats it as one: a note containing a `<script>` tag, an `onerror=`
attribute and a `[click](javascript:…)` link, asserted to render as literal text
with no executable href. It costs little and fails loudly if anyone later adds
an HTML-rendering path.

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

Also here, because both belong to the store rather than to the API above it: the
`getFile()` retry and its mapping onto `StaleWriteError`, and the in-memory
retry queue for transient write failures. The fake needs to be able to fail a
read once and succeed on the retry, and to report a changed `lastModified`
between snapshot and read, or neither path is actually tested.

### Task 5: `localBackend`

**Files:** create `packages/web/src/lib/local/localBackend.ts`.

The API groups over the store plus wasm: pages, journals, sheets, templates,
content types; links/tags/todos/graph derived in memory; search over the
in-memory index.

The per-garden UI-state file and the garden-scoped, encrypted draft key belong
here too, since both are reads and writes through the store — see *No plaintext
at rest* and *Queued writes and drafts*.

The `FileSystemObserver` lives here too: one recursive observation on the active
garden's directory, started on garden open and torn down on lock and switch, with
the self-write filter reading the store's pending-write set, a debounce window
per path, and the full re-read on an `unknown` record. The fake grows an
observer that tests can drive by emitting records, including `unknown`.

### Task 6: Backend resolver

**Files:** create `packages/web/src/lib/backend.ts`; modify
`packages/web/src/lib/api.ts`.

The dispatchers, and demo mode moved onto the new path.

**The dispatchers fail closed.** A group method missing from the local backend
must throw, never fall through to the server implementation — a `??` fallback
there would post a local garden's content to `/api/v1/…`, which is the one
outcome this whole feature exists to prevent. The local backend is typed against
the same interface as the server one so an omission is a compile error, and a
test asserts that every exported member of every group resolves on all three
backends.

Suspending the UI-state sync lands here as well, since the resolver is what
knows a local garden is active.

Also here, since it guards the path content takes into the DOM: the
numeric coercion of the tag-pill style components, and the test asserting that
hostile note content renders as literal text — see *Hostile content in the
folder*.

### Task 7: Registry and UI

**Files:** create `packages/web/src/lib/local/registry.ts`,
`packages/web/src/stores/localGardenStore.ts`; modify
`packages/web/src/components/sidebar/SidebarOptions.tsx`,
`packages/web/src/lib/userSync.ts`.

IndexedDB registry, create/pick/unlock/reconnect flows, merged switcher, feature
gating copy, the `userSync` exclusion.

Plus the draft side of *Queued writes and drafts*: the registry stores the
garden's X25519 recipient, and for an encrypted garden `draftStore` writes
recipient-encrypted drafts rather than plaintext, with recovery deferred until
after unlock. The at-rest assertion in Task 8 covers it.

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
- **The canary test, written before the backend it guards.** In the shape of the
  registry's `records only what the server must never learn`: open a fake
  encrypted local garden, drive the things that normally persist — type a note,
  tag it, start a work session, visit a second sheet — with a canary string in
  the body, the title and the tag name, then assert that no transport call was
  made at all (`fetch` and `sendBeacon` both stubbed and both expected unused)
  and that no `localStorage` value, no IndexedDB record and no Cache Storage
  entry contains the canary. The policy as an executing test rather than as a
  paragraph; a new leak fails it without anyone having to remember this section.
- At-rest check in e2e: after unlocking an encrypted local garden and editing a
  note, dump IndexedDB and assert it contains no note text.

---

## Future: moving a garden between local and server

Not in this plan's scope, and the reason the local-garden dialog says plainly
that Tend will not move a garden for you. Both directions are wanted; they are
not symmetrical, and the asymmetry is the whole design.

### Export: a server garden to a local folder

The easy direction, and it needs no server work at all. The client already has
both backends and the dispatcher that chooses between them, so an export is a
read loop over the server backend and a write loop through the local one — the
same calls the app already makes, pointed at two gardens instead of one.

Encryption is independent of the source: the browser does the encrypting, so an
unencrypted server garden can export to an encrypted local garden, and the
passphrase never leaves the page. That makes this also the answer to "I want
this off the server now", which is a likely reason to want it.

What travels: every sheet of every content type, the content types themselves
(into `.tend/content-types.json`), and the templates. What does not: UI state,
which is per-garden and will be rebuilt, and drafts, which belong to an editing
session rather than to the garden.

### Import: a local folder into a server garden

The hard direction, and the one to be careful with. The server cannot see the
folder, so the browser has to read and decrypt every sheet locally and send it
up. For an *encrypted* local garden that is a plaintext upload of exactly the
notes the user chose to keep off the server — the one thing this whole feature
exists to prevent. So it cannot be a quiet convenience:

- it has to be explicit about what it is doing, in the same terms the
  local-garden dialog uses;
- the destination garden should be encrypted, and the UI should say so if it is
  not, because otherwise the notes end up at rest in the clear on the server;
- content in flight is protected only by TLS, which is a different guarantee
  from the one the user picked.

It should not be bolted onto `importApi`. That is a server-side zip/Logseq
importer with its own error-quarantine flow; this is client-driven and
per-sheet, and sharing the route would mean uploading the folder as an archive —
one large plaintext blob instead of many, which is worse, not better.

### Shared concerns

- **Content types.** Both directions have to reconcile
  `.tend/content-types.json` with the server's per-user registry, which is the
  asymmetry already recorded below.
- **Collisions.** A destination that already holds a sheet of the same name
  needs overwrite / skip / rename, decided once for the run. No merge, for the
  same reason there is none for a write conflict.
- **Interruptibility.** A garden of any size is many operations. It has to
  report what landed, survive being stopped, and be safe to run again — which
  argues for making the collision rule "skip" the default on a re-run.
- **Verification.** The honest check is a round trip: export a garden, import
  it back into a fresh server garden, and compare every sheet's serialized
  bytes. The bridge makes that meaningful, since both sides serialize with the
  same code.

## Not verified / open

- ~~**`age` + `getrandom` for `wasm32-unknown-unknown`**~~ — settled: it builds.
  Both getrandom majors in the tree need their web backend enabled explicitly
  (uuid's 0.3 `wasm_js`, age's 0.2 `js`). The module is 406K gzipped and loaded
  only when a local garden opens. No typage fallback needed. Scrypt speed in
  wasm is still unmeasured in a browser.
- ~~**Toolchain supply**~~ — partly settled: `wasm-bindgen-cli` installs from
  crates.io and must match the `wasm-bindgen` crate version exactly (the build
  script checks). `wasm-opt` is optional and barely helps here. What CI needs,
  and whether the nix flake should provide either, is still open.
- **`FileSystemObserver` reach** — desktop only; there is no Android support,
  and Firefox and Safari do not implement it at all. Consistent with the
  Edge-only target, but it does mean the watcher is a feature of the supported
  browser rather than something the feature can assume everywhere. The
  per-origin limit on concurrent observations is undocumented, so the single
  recursive observer is a precaution, not a measured requirement.
- **Content-type asymmetry** — a local garden's content types live in the client
  registry and are mirrored to `.tend/content-types.json`, but a server pointed
  at the folder reads its own per-user registry instead, so custom types would
  need re-declaring there. Documented, not solved here.
- **Git in a local folder.** Detecting that the chosen folder is already a git
  repository is trivial — `.git` is an ordinary directory entry through the
  handle — and worth doing, so Tend can say so rather than leaving the user
  guessing whether their notes are being committed. *Making* commits is a
  different matter and is deliberately not attempted: the browser cannot run
  `git`, so it would mean `isomorphic-git` over the folder handle (~250K
  gzipped on top of the ~450K bridge, plus an `fs` shim for the File System
  Access API) and a second git implementation alongside the server's `gix`.
  Two implementations of the same thing is the divergence the wasm bridge
  exists to prevent for the file format, and there is no reason to accept it
  here instead. If it is wanted, the shape is an explicit per-garden setting
  the user turns on, not detection that silently starts committing — and
  whatever does it has to apply `tend-git`'s `ensure_gitignore` first, or the
  link index and UI state end up committed, which has happened before.
- **Nothing has run in a browser.** The wasm bridge is exercised under Node and
  the store against an in-memory handle fake; `showDirectoryPicker` needs a user
  gesture, so the real API stays untested until the task 7 UI exists.

## Environment

Settled. The Rust toolchain, the `wasm32-unknown-unknown` target and a matching
`wasm-bindgen-cli` are installed, with `~/.rustup` and `~/.cargo` writable;
nothing else in `$HOME` is. `make test` and `make wasm` both run.
