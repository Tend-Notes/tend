# Review Remediation Guide — 2026-10-15

Source: full security + code-quality review of all Rust crates and the web
client (2026-10-15). Work the phases in order; items within a phase are
independent unless noted. Each item has **Problem / Fix / Verify**. Branch per
item (or per small group), never on trunk.

General rules for this work:

- Do not change the on-disk encryption format or file layout without reading
  the whole of `tend-storage/src/encryption.rs` and `encrypted_fs.rs` first.
- Every fix that touches storage or indices needs a test. Existing test
  patterns live next to the code (`#[cfg(test)]` modules) and in
  `packages/web/e2e/`.
- When a fix is described as "extract a shared helper", the helper replaces
  *all* copies — grep for the duplicates listed before you start.

---

## Phase 0 — Critical: encrypted-garden backups are a false safety net

These two items are one body of work. Do them together, in this order, on one
branch. Until they land, a remote git backup of an encrypted garden **cannot
be restored**: the decryption key is never pushed, and the restore path
silently creates a new key instead of failing.

### 0.1 Include the wrapped identity in git backups

- **Problem**: The per-garden X25519 identity is stored at
  `.tend/identity.age` (`crates/tend-storage/src/encrypted_fs.rs:35`), but
  `ensure_gitignore` (`crates/tend-git/src/backup.rs:181`) ignores all of
  `.tend/` and runs `git rm -r --cached .tend` on every backup. After
  `migrate_to_identity` runs (eagerly, on every unlock —
  `crates/tend-server/src/state.rs:300`), every note file is X25519 ciphertext
  that the passphrase alone cannot decrypt. A clone of the remote is therefore
  permanently undecryptable. The recovery doc-comment in `encryption.rs:22-35`
  (plain `age -d` with the passphrase) is wrong for migrated files.
- **Fix**:
  1. In `ensure_gitignore`, keep ignoring `.tend/` but add negation rules so
     the identity and verify files are tracked:
     ```gitignore
     .tend/
     !.tend/identity.age
     !.tend/encryption.verify
     ```
     Note gitignore semantics: you cannot re-include a file if its parent
     directory is excluded. Use `.tend/*` + `!.tend/identity.age` +
     `!.tend/encryption.verify` instead of `.tend/`, and ignore the index
     subpaths explicitly (`.tend/search_index/`, `.tend/link_index/`,
     `.tend/blocks.db`, `.tend/templates/` stays — decide with reviewer
     whether templates belong in backup; after item 2.1 they are encrypted,
     so tracking them is reasonable).
  2. Update the migration branch of `ensure_gitignore` (it currently rewrites
     a narrow `.tend/search_index/` ignore) to produce the new pattern, and
     make the `git rm --cached` call target only the index paths, not the
     identity/verify files.
  3. This is safe: `identity.age` is the identity encrypted to the passphrase
     via scrypt; `encryption.verify` is a passphrase-encrypted constant. An
     attacker with the remote still needs the passphrase. Both already exist
     before any note ciphertext does.
  4. Fix the recovery instructions in `encryption.rs:22-35` to describe the
     real two-step recovery (`age -d identity.age` → use identity to decrypt
     notes).
- **Verify**: New test in `tend-git`: init an encrypted garden, run
  `backup()`, assert `git ls-files` contains `.tend/identity.age` and
  `.tend/encryption.verify` and does **not** contain `.tend/search_index` or
  `.tend/blocks.db`. Manual end-to-end: create encrypted garden → write a
  page → backup to a bare remote → clone to a fresh dir → unlock with the
  passphrase → page content is readable.

### 0.2 Fail closed when ciphertext exists but the identity is missing

- **Problem**: `load_or_create_identity`
  (`crates/tend-storage/src/encrypted_fs.rs:102`) mints a brand-new identity
  with *whatever passphrase is supplied* whenever both `identity.age` and
  `encryption.verify` are absent. That is exactly the state of a garden
  restored from today's remote (0.1), and also reachable by anyone who can
  delete two files. Existing `.age` files then fail decryption and are
  silently dropped from listings (`debug!` only — `encrypted_fs.rs:195`,
  `:440`, `:596`); new writes fork the garden under the new key.
- **Fix**:
  1. Before minting a new identity, scan the garden for existing `*.md.age`
     files. If any exist and there is no identity/verify file, return a new
     typed error (e.g. `StorageError::MissingIdentity`) telling the user the
     key file is missing and where it should come from. Do NOT mint.
  2. Minting a fresh identity remains correct only for a garden with no
     ciphertext (new garden, or enabling encryption on a plaintext garden).
  3. Upgrade the silent decrypt-failure drops from `debug!` to `warn!` and
     count them; if `list_sheets` drops more than zero files, surface the
     count in the API response so the UI can show "N files could not be
     decrypted" instead of an empty garden.
- **Verify**: Unit test: create encrypted garden, write a page, delete
  `.tend/identity.age` + `.tend/encryption.verify`, attempt unlock → expect
  `MissingIdentity` error, assert no new identity file was created and no
  page was lost. Second test: fresh empty dir + passphrase → identity minted
  (existing behavior preserved).

---

## Phase 1 — High: server availability and brute-force exposure

### 1.1 Explicit-origin CORS crashes the server

- **Problem**: The specific-origins branch
  (`crates/tend-server/src/main.rs:104-108`) combines
  `.allow_credentials(true)` with `.allow_methods(Any)` and
  `.allow_headers(Any)`. tower-http panics on this combination when the layer
  is built, so setting `TEND_CORS_ORIGINS=https://app.example.com` kills the
  process. The only cross-origin config that works is the insecure wildcard.
- **Fix**: Enumerate explicitly instead of `Any`:
  `allow_methods([GET, POST, PUT, DELETE, PATCH, OPTIONS])`, and
  `allow_headers([CONTENT_TYPE, ACCEPT])` plus any custom headers actually
  used by the client (check `packages/web/src/lib/api.ts`). Also add a check
  to `Config::validate` (`config.rs`) rejecting unparseable origin strings so
  typos fail at startup with a message, not silently (`filter_map(.ok())`
  currently drops them).
- **Verify**: Integration test that builds the router with one explicit
  origin and serves a request (this alone panics today). Manual: start server
  with `TEND_CORS_ORIGINS=https://example.com` → starts, preflight from that
  origin succeeds, other origins refused.

### 1.2 Rate limiting: spoofable key + unbounded store

- **Problem** (two parts, `main.rs:124-131`):
  1. `SmartIpKeyExtractor` keys on the leftmost `X-Forwarded-For` entry, which
     the client controls (proxies append; they don't replace the left
     entries). Rotating XFF values gives a fresh bucket per request. This
     nullifies the only throttle on `POST /api/v1/gardens/unlock` passphrase
     guessing (`routes/gardens.rs:810`) — there is no per-garden lockout.
  2. tower_governor's keyed store needs a periodic `retain_recent()` cleanup
     task; none is spawned anywhere in the crate, so the key map grows
     forever. `/api/v1/health` is reachable from untrusted peers
     (`proxy_guard.rs:28,64`) and passes through the governor, so this is
     unauthenticated memory exhaustion when combined with (1).
- **Fix**:
  1. Use `PeerIpKeyExtractor` (the TCP peer) by default. When the peer is a
     trusted proxy (the config already has `trusted_proxies` /
     `trusted_proxy_nets()`), take the **rightmost** XFF entry that is not a
     trusted proxy — that's the proxy-appended client IP. Write this as a
     small custom `KeyExtractor`; do not trust leftmost entries.
  2. Spawn the cleanup task after building the layer:
     ```rust
     let store = governor_config.limiter().clone();
     tokio::spawn(async move {
         loop {
             tokio::time::sleep(Duration::from_secs(60)).await;
             store.retain_recent();
         }
     });
     ```
  3. Separately, add a small in-memory failed-attempt counter to
     `unlock_garden` (e.g. 5 failures per garden → 30s delay, exponential).
     Keep it simple; it only needs to make offline-speed guessing impossible
     online.
- **Verify**: Unit test for the extractor: request with
  `X-Forwarded-For: 1.2.3.4, <proxy-ip>` from a trusted peer keys as
  `1.2.3.4`; a spoofed leftmost entry from an untrusted peer keys as the TCP
  peer. Manual: hammer `/health` with random XFF and confirm 429s still fire
  on the same peer.

---

## Phase 2 — Medium security

### 2.1 Encryption bypass: templates and import-error files

- **Problem**: In an encrypted garden, two paths write plaintext to disk:
  templates via raw `tokio::fs::write`
  (`crates/tend-server/src/routes/templates.rs:110-116`) and failed-import
  note content under `import-errors/`
  (`crates/tend-server/src/routes/import.rs:673-708`). Both bypass
  `EncryptedFileManager`.
- **Fix**: Route both through the garden's file manager so encrypted gardens
  encrypt them (the manager trait already abstracts plain vs encrypted —
  follow how `write_sheet` is dispatched). Migration: on unlock, if plaintext
  template/import-error files exist in an encrypted garden, re-encrypt them
  (mirror `migrate_to_identity`'s pattern).
- **Verify**: Test: encrypted garden → save a template and a failed import →
  read the raw files on disk → both start with the age header
  (`is_age_encrypted`), and round-trip through the API correctly.

### 2.2 Path traversal via `date` in `accept_import_error`

- **Problem**: `routes/import.rs:901-910` joins user-supplied `req.date`
  unvalidated: `garden_path.join(&content_type.directory).join(&date)` then
  `create_dir_all`. For a date-foldered content type,
  `date = "../../../../x"` creates directories anywhere the process can
  write. The `dest_path.exists()` duplicate check also inspects a different
  path than the one actually written.
- **Fix**: Parse the date strictly before using it:
  `NaiveDate::parse_from_str(&date, "%Y-%m-%d")` and rebuild the folder name
  from the parsed value (`parse_date` in the sheets routes already does this —
  reuse it). Then compute `dest_path` once and use the same value for the
  existence check and the write.
- **Verify**: Test posting `date: "../../evil"` → 400, no directory created
  outside the garden. Test the duplicate check now fires for date-foldered
  types.

### 2.3 `delete_sheet` skips the symlink/containment check

- **Problem**: Reads and writes call `ensure_within_root`; both deletes do
  not (`crates/tend-storage/src/fs.rs:711-755`,
  `crates/tend-storage/src/encrypted_fs.rs:705-747`). `validate_safe_name`
  permits `/` in names, so a symlinked directory inside the garden (possible
  via `pull()`, which — unlike init/import — never sets
  `core.symlinks=false`, `backup.rs:838`) lets a delete unlink `.md` files
  outside the garden.
- **Fix**: Call `ensure_within_root` in both `delete_sheet` implementations
  before `remove_file` (copy the pattern from `read_sheet`). Also set
  `core.symlinks=false` in `pull()` like `init_repo` does.
- **Verify**: Extend the existing symlink tests in `fs.rs` with a delete
  case: symlinked dir inside garden → delete through it → refused, target
  untouched.

### 2.4 Secrets in git remote URLs reach logs and clients

- **Problem**: `validate_remote_url` (`backup.rs:1353`) accepts
  `https://user:TOKEN@host/...`. The URL is then logged at info
  (`backup.rs:887`, `:961`, `:1162`) and surfaces in client-visible payloads:
  `GitStatus.remote`, `test_remote` messages built from raw git stderr
  (`backup.rs:982-1033`), and push/pull failure strings (`backup.rs:833`,
  `:874`). Git echoes the URL in its error output.
- **Fix**: Add a `redact_userinfo(url) -> String` helper in `backup.rs`
  (replace `user:pass@` with `user:***@`) and use it in every log line and
  every string that leaves the crate. For git stderr, run the raw output
  through the same redaction before embedding it in errors. (The web client
  already has `redactRemoteUrl` in `SidebarOptions.tsx:44` — mirror its
  behavior server-side so defense doesn't depend on the client.)
- **Verify**: Unit tests: URL with token → redacted in `status()` output and
  in a forced push-failure message.

### 2.5 Typed wrong-passphrase error (do with 0.2)

- **Problem**: `routes/gardens.rs:850-857` picks 401 vs 500 by
  `err_msg.contains("Invalid passphrase")`; the string originates three
  layers down as `StorageError::Other`. Any rewording turns wrong-passphrase
  into a 500 carrying internal detail.
- **Fix**: Add `StorageError::WrongPassphrase` (and `MissingIdentity` from
  0.2) variants; map them in `encrypted_fs.rs:112` and the route matches on
  the variant, not the string.
- **Verify**: Existing unlock tests still pass; new test asserts a wrong
  passphrase yields 401 with the generic message.

### 2.6 Client: plaintext drafts survive session expiry

- **Problem**: On confirmed session expiry the client purges SW content
  caches but deliberately saves the current draft — possibly from an
  encrypted garden — to IndexedDB first, unencrypted, no TTL
  (`packages/web/src/stores/authStore.ts:100-114`,
  `packages/web/src/lib/cacheReset.ts:19`). It is only cleared when a
  *different* user later signs in.
- **Fix**: Decide the product behavior with the reviewer first. Recommended:
  keep the draft through a *re-auth of the same user* (that is the feature's
  point) but add a TTL (e.g. 24h, checked on restore) and always purge drafts
  belonging to encrypted gardens on expiry — the server-side encryption
  promise should not be voided by the client. The garden's encrypted flag is
  available in the gardens store; thread it into the draft record.
- **Verify**: e2e (see `packages/web/e2e/` harness): expire session in an
  encrypted garden with a dirty draft → IndexedDB `tend-drafts` is empty;
  same flow in a plaintext garden → draft survives and restores.

### 2.7 Client: duplicate garden-switch resets, two missing the purge

- **Problem**: The reset sequence (reset stores, `history.replaceState('/')`,
  refetch, re-init) exists in four copies; only the WebSocket copy calls
  `clearUserScopedContent()`. The two `SidebarOptions.tsx` copies
  (`:1595-1609` switch, `:1647-1663` unlock) skip the cache/draft purge that
  exists so a locked garden's plaintext can't linger.
  (`useWebSocket.ts:196-223`, `App.tsx:133-145` are the other copies.)
- **Fix**: Extract one `resetForGardenSwitch()` in a shared module (e.g.
  `lib/cacheReset.ts`) that includes `clearUserScopedContent()`; call it from
  all four sites.
- **Verify**: e2e: switch gardens via the sidebar → previous garden's page
  content absent from Cache Storage and stores.

---

## Phase 3 — Lower-severity security hardening

Do these as a batch; each is small.

- **3.1 Dev-mode CSRF**: with `auth.required=false` the CSRF guard is fully
  disabled (`csrf.rs:14-15`, `main.rs:185`), leaving multipart import
  (`overwrite=true`), `/git/push`, `/git/pull`, `/reindex`, restore
  form-submittable cross-site, plus DNS rebinding (no Host validation). Fix:
  keep the Origin/Referer check active in dev (allow missing-Origin for
  non-browser clients), and validate `Host` is loopback/expected when auth is
  off.
- **3.2 WS identity fallback**: `ws.rs:264-272` — when the verify service
  validates the session but returns no identity header, the server uses the
  client-claimed `Remote-User`. Fix: make this opt-in
  (`TEND_WS_TRUST_CLIENT_USER=true`) and refuse by default; log loudly.
- **3.3 Origin check**: `origin.rs:31-40` ignores scheme and trusts
  `X-Forwarded-Host`. Fix: compare full scheme+host against a configured
  canonical origin (`TEND_PUBLIC_ORIGIN`), falling back to current behavior
  only when unset.
- **3.4 Create-on-GET**: navigating to `/page/<name>` auto-creates the page
  server-side (`packages/web/src/stores/pageStore.ts:459-474` via
  `initializeFromUrl`). Fix: on 404 during URL init, show a "create this
  page?" state instead of writing; keep auto-create only for explicit
  in-app actions (wikilink click is a user gesture — reviewer's call whether
  that stays).
- **3.5 Client CSP**: add a CSP for the SPA (the backend already sends
  security headers for API responses; ensure the document response carries
  `script-src 'self'; object-src 'none'; base-uri 'none'; connect-src 'self'
  https://api.github.com https://raw.githubusercontent.com`). Serve via the
  static-files headers in `tend-server` (preferred over a meta tag).
- **3.6 `safeHref` hardening**: `packages/web/src/lib/safeHref.ts:3` — strip
  `[\x00-\x20]` before testing, or allowlist `^https?:`. Currently
  unreachable but it is the documented last line of defense.
- **3.7 Theme color validation**: `packages/web/src/lib/themes.ts:316-323` —
  validate palette values against `/^#[0-9a-fA-F]{6}$/` before
  `style.setProperty`; values come from a third-party GitHub fetch and user
  paste.
- **3.8 Zeroization**: pass the passphrase as `SecretString` end-to-end
  (axum extractor → `switch_garden_encrypted`, `state.rs:1302`), and use
  `zeroize` on the decrypted identity string in `unwrap_identity`
  (`encryption.rs:153`). Low value but cheap.
- **3.9 CSRF header belt-and-suspenders (client+server)**: send
  `X-Requested-With: tend` on all mutating requests from `api.ts` and require
  it server-side for multipart endpoints (the one "simple request" shape,
  `api.ts:752-760`).

---

## Phase 4 — Correctness bugs (quality, user-visible)

- **4.1 Stale indices after sheet deletion**:
  `routes/sheets.rs:512` removes by bare `path.name`, but indexing uses the
  qualified name from `build_sheet_page_name` (`sheets.rs:32`; see `:302`,
  `:471`, `:482`). Deleted sheets keep appearing in search/backlinks/tags/
  todos until a full rebuild. Fix: qualify before removal. Same mismatch at
  `import.rs:992`. Test: create custom sheet with a tag + TODO → delete →
  search/tags/todos all empty.
- **4.2 Non-ASCII filename corruption**: `decode_filename`
  (`tend-storage/src/fs.rs:44-62`) pushes raw bytes as chars → "Café" becomes
  mojibake in every listing, breaking the list→read round-trip. Fix: collect
  decoded **bytes** and `String::from_utf8` once at the end. Test with
  multi-byte names including `%`-encoded sequences.
- **4.3 Editor saves stale content after external updates**: the PM doc is
  built once per mount (`OutlineEditorV2.tsx:69-185`, empty dep array) and
  `MainContent.tsx:167` keys the editor only on page name + mode — draft
  restore, WS silent reloads, and "keep server version" update the store but
  the editor keeps (and re-saves) the old doc. Fix: include
  `currentPage.version` (or `modifiedAt`) in the editor key, or sync the PM
  doc when the page object is replaced externally. Same for
  `LongformEditor.tsx:126`. e2e: edit page in two tabs → conflict → "keep
  server version" → editor shows server content and next keystroke doesn't
  resurrect the old text.
- **4.4 `create_page` misses tag/todo indexing + broadcast**:
  `routes/pages.rs:63-90` hand-rolls index updates instead of calling
  `update_all_indices`. Fix: call it. Test: create page with `#tag` and
  `TODO` in content → both appear in `/tags` and `/todos`.
- **4.5 `flushPendingSave` drops `properties`**: page-save logic is
  triplicated in `pageStore.ts` (`:306-359`, `:869-911`, `:787-816`) and the
  flush copy omits `properties`, so a property change pending at navigation
  is lost. Fix: extract one `savePageToServer` helper used by all three.
- **4.6 Task-keyword lists diverged**: `indices.rs:133-135`
  (`TODO|DOING|DONE|NOW|LATER|NEVER`) vs `tend-core/src/block.rs:67-102`
  (knows `WAITING`/`CANCELLED`, not `NEVER`) — a `WAITING` task never reaches
  `/todos`. Client has three more copies (`contentRenderer.ts:62`,
  `outline2/nodeview.ts:14`, `taskStore.ts:18`). Fix: one canonical list in
  `tend-core` for the server; one exported constant for the client; delete
  the copies.
- **4.7 Watcher gaps**: `watcher.rs:123` only forwards `md` extensions
  (encrypted gardens' `.md.age` never emit events) and only `pages/` +
  `journals/` are watched — custom content-type dirs are invisible. Fix:
  accept `.md.age`, watch the garden root, filter out `.tend/`.
- **4.8 `pending_writes` leak on delete**: `fs.rs:744-750` /
  `encrypted_fs.rs:737-742` insert on delete but never remove (writes do, via
  delayed cleanup) — unbounded growth, and a recreated file is permanently
  invisible to the watcher. Fix: schedule the same delayed removal as
  `write_file`.
- **4.9 Nondeterministic serialization**: `serializer.rs:22-24`, `:88-97`
  iterate `HashMap` properties → identical content serializes differently →
  spurious git diffs and auto-backup commits. Fix: sort keys (or `BTreeMap`).
  Test: serialize twice → byte-identical.

---

## Phase 5 — Performance

- **5.1 `get_user_state` holds the global write lock across init**
  (`state.rs:1536-1573`): file I/O, index loads, possibly a full rebuild — one
  slow user stalls every request. Fix: insert a `Arc<OnceCell<UserState>>`
  placeholder under the lock, build outside it.
- **5.2 scrypt on the async executor**: identity unwrap + legacy-file
  migration run inline in the unlock handler
  (`encrypted_fs.rs:79`, `:192`). Fix: `spawn_blocking` (pattern: `run_git`
  in `backup.rs`).
- **5.3 Import buffers 500 MB twice**: `import.rs:199` (`data.to_vec()`) and
  `:348` (`zip_data.clone()`, never used after). Fix: keep the `Bytes`, move
  it into `spawn_blocking`. Add a per-user concurrent-import cap while there.
- **5.4 `/reindex` reads the garden ~6×**: `reindex.rs:52-171` + stabilize
  phase 2 (`:310-354`) rebuild each index separately;
  `rebuild_indices_single_pass` (`state.rs:831`) already does it in one pass.
  Fix: route both through the single-pass rebuild.
- **5.5 `LinkIndex::index_page` is O(total links) per save**
  (`tend-links/src/lib.rs:338-355`): drains + rebuilds everything per
  autosave. Fix: key entries by source page; patch only affected buckets.
- **5.6 Search takes the write lock per query** (`routes/search.rs:287-289`)
  just to maybe-commit. Fix: dirty-flag check under a read lock; commit (in
  `spawn_blocking`) only when dirty.
- **5.7 Per-handshake `reqwest::Client`** (`ws.rs:159`): hoist one client
  into `AppState`.
- **5.8 Client render hot paths**: full `DecorationSet` rebuild per
  keystroke/caret move (`decorations.ts:44-127`) → map the old set, recompute
  only changed lines; `Sidebar.tsx:68` subscribes to the whole pageStore →
  `useShallow` selectors; `useAutoCommit.ts:40` subscribes to `currentPage`
  from App and churns its interval → read via `getState()` in callbacks;
  `TaskMetadata.tsx:49` per-task-row full-page subscription → select three
  fields; `taskStore.ts:179` refetches all todos after every successful task
  edit → reconcile only on failure; `taskStore.ts:203` fetches at module
  import → move to app init; `SidebarGraph.tsx:367` rebuilds the d3
  simulation on navigation → split build from highlight;
  `SidebarTags.tsx:51` refetches per keystroke burst → key off
  `currentPage.version`.

---

## Phase 6 — Cleanup (do last; each is a small PR)

- Deduplicate `fs.rs` / `encrypted_fs.rs` (~500 lines: `sheet_path`,
  `collect_sheet_refs`, `list_sheets`, `read_sheet`, `write_sheet`,
  `delete_sheet`, `sheet_exists`) behind one manager parameterized over an
  encode/decode step. **Do this after Phases 0/2/4 land** so the dedup
  doesn't entangle with behavior fixes.
- `backup()` vs `commit()` in `backup.rs:558-740`: make `backup` =
  `commit(None)` + push. Inline `detect_remote_branch` reimplementation at
  `backup.rs:1187-1213` → call the function.
- `state.rs:1114-1168` / `:1208-1255` hand-parse gardens.json; reuse the
  typed mtime-cached loader in `gardens.rs:245-299`.
- `get_block` vs `load_page_for_block` (`routes/blocks.rs:99-143` vs
  `:250-284`); `copy_block_tree` outer/inner duplication
  (`sheets.rs:73-157`, note the unchecked `unwrap` at `:124`).
- Client: `SidebarOptions.tsx` raw `fetch()` calls (`:1480,1522,1570,1633,
  1677,1699,1717`) → use `api.gardens` (restores expired-session detection);
  delete the locally redeclared `ArchivedGarden` (`:1443`).
- Consolidate the three client content renderers (`contentRenderer.ts`,
  `renderTaskContent.tsx:5-60`, `BacklinksPanel.tsx:185-230`) on
  `parseContent`/`renderContentReact`.
- Delete dead code: `FileWatcher` stub (`watcher.rs:30-92`), deprecated
  single-tenant loaders (`routes/gardens.rs:127-231`), `stop_backup_task`
  (`state.rs:1447`), `verify_passphrase` (`encrypted_fs.rs:220`),
  `get_index_info`, `serialize_blocks`; client: `pageStore.updateBlockContent`,
  the dead `gitStore.checkSmartCommit/checkAutoCommit/triggerAutoCommit` trio,
  unused `tagStore`/`selectionStore`/`recentSheetsStore`/`draftStore`/
  `useTheme` members, and stop persisting `searchOpen`
  (`uiStore.ts:182-190`).
- `is_age_encrypted` (`encryption.rs:162-171`): second branch unreachable.
- `tend-links/src/lib.rs:502-514`: use the `hex` crate.

---

## Not covered by this review

- Dependency advisories: run `cargo audit` and `pnpm audit --prod` in CI (the
  review sandbox couldn't) and triage before starting Phase 1.
- Known accepted limitations (documented, no action unless product says so):
  filenames, garden name (`.garden-meta`), file sizes, and edit timing remain
  plaintext for encrypted gardens; verify/identity files enable offline
  passphrase guessing (inherent to passphrase design, cost-limited by
  scrypt); in-memory indices hold decrypted content in swappable heap while
  unlocked.
