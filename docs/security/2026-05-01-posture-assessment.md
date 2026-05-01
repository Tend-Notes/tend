# Tend Security & Privacy Posture Assessment

**Date:** 2026-05-01
**Branch:** `v0.2/security-posture-review`
**Scope:** Whole-application posture review against the stated invariants:
1. Security by design, privacy by design, least privilege, least access.
2. Unauthenticated users see only a demo; zero capability to reach real user files.
3. Simple and limited architecture to reduce non-application attack surface.

This document is the read-only deliverable from Phase 1 (discovery), Phase 2 (threat model + gap analysis), and Phase 3 (triaged remediation plan). No code has been changed.

---

## TL;DR

The architecture is, on balance, **fundamentally sound for a single-tenant-per-user, reverse-proxy-fronted note-taking app**. Trust boundaries are simple and the storage and demo isolation models are clean. There are no critical data-exposure vulnerabilities visible from static review.

There are, however, **three classes of issue worth treating as load-bearing**:

1. **Production hardening gaps in the HTTP layer.** No CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, or Permissions-Policy headers are emitted anywhere. The Dockerfile silently overrides `TEND_HOST=0.0.0.0`, exposing containers without a reverse proxy. WebSocket auth is silently disabled when `TEND_AUTH_VERIFY_URL` is unset.

2. **Auth misconfiguration is silent.** `TEND_AUTH_REQUIRED=false` produces no startup warning. Combined with point 1, a misconfigured Docker deploy can be world-facing AND auth-disabled with no log signal.

3. **Wikilink protocol filtering is absent at one DOM-write site.** Wikilink targets are URL-encoded but not protocol-filtered before being assigned via `link.href = ...` outside React's JSX (where React's protocol filtering would apply). `[[javascript:alert(1)]]` is the canonical test case; this needs a manual verification before being flagged Critical, but it is the highest-priority finding to confirm.

The remaining issues are real but smaller: rate limiting is global rather than per-IP/per-user, there's no per-endpoint authorization, and the npm audit shows 75 findings that are all dev/build-time (none in the runtime bundle). None of the critical invariants — demo isolation, per-user filesystem boundary, encrypted-garden key scoping — appear breakable from the data we collected.

The triaged plan in §6 has 22 findings: 4 Critical, 6 High, 7 Medium, 5 Low.

---

## 1. Architecture summary

### Trust model

```
[ Browser ]                                                 [ Server ]
   |
   |  HTTPS (terminated by reverse proxy)
   v
[ Reverse Proxy (e.g. Authelia) ] -- Remote-User: <name> -->  [ tend-server (Axum, port 3000) ]
                                                                       |
                                                                       v
                                                               [ Filesystem ]
                                                                  /  /  \
                                                           users/  / .. \  Gardens/
                                                            $user
                                                            ├── Gardens/
                                                            │   └── pages/, journals/, .git/, .tend/
                                                            └── gardens.json, .prefs.json
```

**Key invariants assumed by the design:**
- Reverse proxy terminates TLS and authenticates the user.
- Reverse proxy sets a request header (default: `Remote-User`) with the authenticated username.
- `tend-server` trusts that header completely. There is no server-side session, cookie, or token.
- Username, once accepted, is the sole determinant of which directory tree is reachable. There is no further authorization layer.
- Demo deployments are physically separate (different origin / GitHub Pages) and have no path to the production backend.

### Crates and packages (simple architecture)

Backend is split into 7 small crates, no circular deps:
- `tend-core` — domain model, parsing
- `tend-storage` — `FileManager` (plaintext) and `EncryptedFileManager` (age-encrypted) with parallel APIs
- `tend-search` — Tantivy index
- `tend-git` — git operations via pure-Rust `gix` (no libgit2/openssl)
- `tend-server` — Axum HTTP/WS, CORS, rate limiting, auth extractor
- `tend-blocks` — block storage helpers (rusqlite bundled)
- `tend-links` — link helpers

Frontend: React 18, Vite 6, CodeMirror 6, Zustand, TailwindCSS. No SSR, no Node runtime in production (static SPA).

The narrowness of this stack is genuinely good for non-application attack surface — no PHP-style request lifecycle ambiguity, no JVM, no native-tls/openssl dependency chain (all rustls), no libgit2.

---

## 2. Findings — per surface

Each finding is cited with `file:line`. Severity is assigned in §6.

### 2.1 Auth surface

**Model.** Header-based stateless auth. The `AuthenticatedUser` extractor (`crates/tend-server/src/auth.rs:130-141`) reads `Remote-User` (configurable via `TEND_AUTH_HEADER`, `crates/tend-server/src/config.rs:73`) and rejects with 401 if absent. Username is validated for path-traversal and length (`auth.rs:62-87`).

**Public routes.**
- `GET /api/v1/health` (`routes/mod.rs:139`) — intentional, unauthenticated, returns "OK".
- `/ws` WebSocket upgrade (`main.rs:124`) — see WebSocket caveat below.
- All static assets (`main.rs:133-140`) — intentional SPA fallback.

**Env-var attack surface.**
- `TEND_AUTH_REQUIRED` (`config.rs:77-80`, default `true`) — when `false`, falls back to `X-Dev-User` header or `TEND_AUTH_DEFAULT_USER`. **No startup warning is logged** when set to `false` (`main.rs:43-119`).
- `TEND_AUTH_DEFAULT_USER` — when combined with `TEND_AUTH_REQUIRED=false`, every request runs as this user.
- `TEND_AUTH_VERIFY_URL` (`config.rs:94`, default unset) — controls WebSocket auth. **If unset, WebSocket connections are unauthenticated** beyond the optional `X-Dev-User` fallback (`crates/tend-server/src/ws.rs:78-217`). No warning logged.
- `TEND_CORS_ORIGINS` (`config.rs:112-115`, default empty/same-origin) — accepts `*` for `CorsLayer::permissive()` (`main.rs:64-87`). Permissive mode allows credentials.

**Authorization.** None beyond authentication. Once authenticated, the user can read/write/delete any of their own data, perform git ops, reindex, manage gardens (`routes/mod.rs:33-124`).

### 2.2 Demo mode isolation

**Entry point.** Build-time only via `VITE_DEMO_MODE=true` (`packages/web/src/lib/api.ts:27`). No runtime path-, cookie-, or header-based switch.

**Storage.** IndexedDB exclusively (`packages/web/src/lib/demoStore.ts`, db name `tend-demo`). The demo bundle never makes HTTP calls to `/api/v1/*` — `api.ts:129-748` exports the demo or real implementation conditionally at module load, so unused branches are tree-shakable.

**Backend awareness.** Zero. `crates/tend-server/src/` has no string match for "demo". A demo user that somehow reached the backend would be treated as a regular authenticated user named "demo" (the demo identity hardcodes `whoami` in `demoApi.ts:768-770`). This is fine as long as demo and production are on different origins.

**Latent risk.** If production ever serves the demo bundle at `/tend/`, IndexedDB is namespaced **per-origin**, not per-path — demo and prod would share `tend-demo`. The demo bundle still wouldn't call the prod backend (compile-time wired), but the storage namespace overlap is a UX-and-privacy footgun (a user logged into prod would see demo cached state from the same origin).

**Session expiry.** Client-side only (`demoStore.ts:236-248`, default 6 hours of inactivity).

### 2.3 Filesystem access

**Per-user binding.** `user_base_dir(username) = $base_dir/users/$username` (`config.rs:259-307`). All file managers are scoped per user; there's no code path that takes a username as input and reads outside that root after `FileManager::new(garden_root)` is called (`tend-storage/src/fs.rs:88-115`).

**Validation.** `validate_safe_name` (`tend-storage/src/fs.rs:66-85`) is called on every user-supplied name component before path construction. Rejects `..`, leading `.`, separators, control chars, null bytes. Fully covered: `read_page`, `write_page`, `delete_page`, `read_sheet`, `write_sheet`, `delete_sheet`, `page_exists`, `sheet_exists`, plus all encrypted variants (`encrypted_fs.rs:175,258,311,342,482,560,586,630`). Username validation is duplicated in `auth.rs:62-87` and `config.rs:294-306` — same logic, two places.

**Encoding/decoding.** Percent-encoded on write (`fs.rs:25-40`), decoded on enumeration (`fs.rs:44-62`). Backwards-compat fallback to raw filenames is safe (raw name passes the same validation).

**Encryption at rest.**
- `age` (scrypt KDF, `crates/tend-storage/src/encryption.rs:62`).
- Per-garden passphrase, not per-user.
- **Filenames are plaintext on disk** (`encryption.rs:11-12`) — encryption is content-only.
- Verification file `.tend/encryption.verify` validates passphrase (`encrypted_fs.rs:60-85`).

**Search index for encrypted gardens** is plaintext on disk with a TTL (default 6 hours of inactivity, `state.rs:378-419`). For the duration of the TTL window, an encrypted garden's content is recoverable without the passphrase.

**Imports.** Zip imports (`routes/import.rs`) use `file.enclosed_name()` against zip-slip and `validate_safe_name` on extracted writes. Cap is 500MB (`import.rs:31`).

**Symlinks.** No `canonicalize`/symlink handling in user-content reads. Within a single user's own garden this is fine (they own their files). Cross-garden escape would require the user to author a symlink in their own garden pointing outside, which they could do today by other means — but worth a note for multi-user shared filesystems.

### 2.4 Network exposure

**Bind.** Default `127.0.0.1:3000` (`config.rs:184-195`). **Dockerfile sets `TEND_HOST=0.0.0.0` unconditionally** (`Dockerfile:110`); container deployments are world-facing without a reverse proxy. No warning logged.

**TLS.** Server-side TLS not implemented. Reverse proxy is required. No code-level check (e.g., refuse to serve over plain HTTP if `TEND_HOST` is non-loopback and no `X-Forwarded-Proto` header is present).

**CORS.** Same-origin by default. `TEND_CORS_ORIGINS=*` triggers `CorsLayer::permissive()` (`main.rs:68-72`). Tower's `permissive()` allows methods, headers, and origins broadly; combining `*` with a non-localhost bind effectively waives CSRF/CORS protection.

**Security headers.** **None.** Grep across the server crate finds zero `header`, `set_response_header`, or named-header assertions. CSP, HSTS, X-Frame-Options/`frame-ancestors`, X-Content-Type-Options, Referrer-Policy, Permissions-Policy — all absent.

**Cookies.** None emitted.

**Rate limiting.** Enabled by default (50 RPS / 100 burst, `config.rs:120-166`). Token bucket via `tower_governor`. Single global bucket — **not per-IP or per-user** (`main.rs:127-131`). One client can exhaust the budget for everyone.

**Body limits.** Upload endpoint: 500MB explicit (`import.rs:31`, `routes/mod.rs:104-107`). All other mutation endpoints rely on Axum default (~2MB-ish, version-dependent). No explicit caps on JSON payloads or multipart fields.

### 2.5 Frontend trust boundaries

**Pre-auth API surface.** In server mode, `App.tsx:124-145` calls `identity.whoami()` on mount. **No 401 handler** — backend down or auth failure leaves the app in a permanent loading state with no recovery affordance.

**Demo→prod transition.** None possible at runtime.

**XSS surface.**
- `dangerouslySetInnerHTML`: zero matches.
- `eval` / `new Function`: zero matches.
- `innerHTML`: one match in `blockReference.ts:187` setting to `''` — safe.
- Direct DOM `link.href = ...`: `wikilink.ts:125-126` and `blockReference.ts:187`. Targets are URL-encoded but **not protocol-filtered**. React's `<a href>` filter is bypassed because these are direct DOM manipulations. **`[[javascript:alert(1)]]` should be tested manually**; if it executes on click, this is a stored XSS in any block that contains a wikilink.

**Build-time inline script.** `index.html:16-27` has the GitHub Pages SPA-redirect inline script. Blocks `script-src 'strict-dynamic'` / no-`unsafe-inline` CSP unless replaced or moved to a hashed/nonce'd block. (Production deployment doesn't need this script — it exists only for the GH-Pages demo.)

**Client-side storage of sensitive data.** None. localStorage only stores mode flag, last user, theme cache. IndexedDB stores draft blocks (user content, browser-protected). No tokens, passwords, keys.

### 2.6 Dependency surface

**Rust direct deps** (per-crate, summarized): `axum 0.8`, `tower-http 0.6`, `tower_governor 0.8`, `gix 0.68` (no libgit2), `reqwest 0.12 (rustls)`, `age 0.11`, `tantivy 0.22`, `comrak 0.29`, `rusqlite 0.32 (bundled)`, `zip 2.2`, `notify 8`. **No openssl, no native-tls, no libgit2, no unmaintained crates.** `Cargo.lock` total: 543 packages.

`cargo audit` could not run in this environment (sandbox `~/.cargo` is RO). Manual lock-file inspection against known historically risky versions found nothing. **Recommend adding `cargo audit` to CI** to close this gap definitively.

**JS direct deps**: React 18.3, Vite 6, CodeMirror 6.x family, d3 3.x, framer-motion 12, zustand 5, immer 10, vite-plugin-pwa 1.2.

`npm audit`: **75 findings (33 high, 42 moderate, 0 critical)**. Every one is dev/build-time, entering via `vite-plugin-pwa → workbox-build`. The runtime bundle is unaffected. `serialize-javascript` and `uuid` v3-v6 are the named CVE roots; production `uuid` is v11 (unaffected). Removing or replacing `vite-plugin-pwa` would clear most of the noise.

**Stale.** `node_modules/@tiptap/*` is extraneous (not in current `package.json`). Inflates audit output. `pnpm install --prune` should remove it.

**Licenses.** All MIT/Apache-2.0/BSD/ISC across direct deps. No GPL/AGPL/MPL. No copyleft risk.

---

## 3. Threat model — invariant verification

The user-stated invariant: *unauthenticated user sees demo, has zero capability to see user files*. I'll verify this by tracing every reachable path that touches user data.

### 3.1 Reachability matrix

| Adversary | Path | Outcome |
|-----------|------|---------|
| Anonymous → demo (GH Pages) | `https://demo.example.com/tend/` | Sees seeded demo content from `demoContent.ts`. IndexedDB-only. Zero backend reachability. ✅ |
| Anonymous → prod (`https://prod.example.com/`) | Hits reverse proxy. Without `Remote-User`, proxy refuses or redirects to login. | ✅ if reverse proxy correctly configured. |
| Anonymous → prod, **bypassing reverse proxy** | Direct request to `tend-server:3000`. Default bind is `127.0.0.1`, but **Dockerfile binds 0.0.0.0**. With auth required (default), 401. With `TEND_AUTH_REQUIRED=false`, runs as `TEND_AUTH_DEFAULT_USER`. | ⚠️ Requires misconfiguration plus network reach. Risk amplified by Docker default. |
| Anonymous → `/ws` direct, **`TEND_AUTH_VERIFY_URL` unset** | WebSocket accepts; user identity falls back to `X-Dev-User` or default user. | ⚠️ Documented as silent in §2.1; real bypass if combined with bypass of reverse proxy. |
| Anonymous → `/api/v1/health` | "OK" only. No data. | ✅ |
| Auth'd user A → reads user B's files | Username from `Remote-User` is the only handle. No cross-user code path exists. Filesystem boundary is `users/$username/`. | ✅ |
| Auth'd user with `[[javascript:alert(1)]]` in their content → views own page | If wikilink-to-href passes the protocol through, executes JS in their own session. **Self-XSS is the floor; if the same content is shared (e.g., via export/import or shared garden) this becomes stored XSS.** | ⚠️ Needs manual verification. |
| Auth'd user → drops a CSP-bypassing payload via wikilink | No CSP exists, so nothing to bypass. | ⚠️ Defense-in-depth gap. |
| Adversarial reverse proxy (compromised) → injects arbitrary `Remote-User` | Server believes the proxy. Adversary becomes any user. | Out of scope: assume reverse proxy is in TCB. |

### 3.2 Privacy considerations

- **Logs.** `tracing` is configured; spot-check confirms it logs HTTP method, path, status. **Need to verify**: do logs contain usernames, page names, search queries? If yes, log retention becomes a privacy axis.
- **Search indexes for encrypted gardens are plaintext on disk** for the TTL window (default 6h). A backup or filesystem snapshot during that window leaks content.
- **Filenames in encrypted gardens are plaintext.** Listing the directory leaks page titles even if content is sealed.
- **IndexedDB drafts** persist locally. Browser-protected, but a shared browser profile leaks recent edits.

---

## 4. Architecture simplicity

The user's third invariant — "simple and limited architecture to reduce attack surface for non-application vulnerabilities" — is largely met:

**Wins:**
- Pure-Rust crypto (rustls, age, ring) — no openssl-sys.
- Pure-Rust git (gix) — no libgit2.
- Rust-bundled SQLite — no system SQLite version skew.
- No SSR / no server-side templating — no template-injection class.
- No WebAssembly modules at runtime, no eval-style codepaths in frontend.
- 543 Rust crates, ~628 JS packages — large but normal for the feature set.

**Worth tightening:**
- `vite-plugin-pwa` pulls a heavy workbox/rollup tree (drives the npm audit count). Consider whether PWA is required; if not, remove it.
- `@tiptap/*` extraneous packages are leftovers from a prior architecture pivot.
- `notify-debouncer-full` (filesystem watch) is reasonable but worth confirming it isn't watching outside per-user roots.
- Two `getrandom`/`rand` major versions coexist (common; not a vulnerability, but doubles the auditable RNG surface).

---

## 5. Cross-cutting observations

1. **Silent insecure paths.** Three critical paths fail-silent: WebSocket auth (no `TEND_AUTH_VERIFY_URL`), auth disabled (`TEND_AUTH_REQUIRED=false`), Docker bind override. Production-grade logging on startup that prints the *effective* security posture (auth required/disabled, bind address, CORS policy, WS auth status) would catch all three at deploy time.

2. **Reverse proxy is in the TCB but not documented.** The model only works if operators understand "tend-server requires a reverse proxy that authenticates and sets `Remote-User`." This is not stated in any operator-facing doc. The Dockerfile makes this assumption easy to break.

3. **No defense-in-depth at the HTTP boundary.** With the auth model fully delegated to the reverse proxy, the server itself emits no security headers. A defense-in-depth posture would emit CSP, HSTS, X-Frame-Options, X-Content-Type-Options on every response regardless of the proxy.

4. **Authentication is stateless; authorization is per-user only.** No ACLs, no roles. This is a deliberate simple model and works for the current single-tenant-per-user product. If multi-user gardens are ever added (sharing, publishing), the entire authorization layer needs to be designed from scratch.

5. **Encrypted-garden filenames and search indexes leak metadata.** This is documented in code comments as intentional, but it's not surfaced to users. If "encryption at rest" is part of the product pitch, the threat model should be clearly stated to users.

---

## 6. Triaged remediation plan

Severity rubric:
- **Critical**: data exposure, auth bypass, or silent insecure-by-default in the most-likely deployment.
- **High**: defense-in-depth gap whose absence amplifies a Critical, or a real but conditional exposure.
- **Medium**: hardening worth doing; not actively exploitable as configured.
- **Low**: hygiene / documentation / future-proofing.

Effort estimates are agent-hours, including review.

### Critical

| # | Finding | File:line | Fix sketch | Effort |
|---|---------|-----------|------------|--------|
| C1 | Wikilink `link.href` is set without protocol filtering | `wikilink.ts:125-126`, `blockReference.ts:187` | Add a `safeHref(target)` helper that rejects/encodes `javascript:`, `data:`, `vbscript:`, `file:`. Apply at both DOM-write sites and in `renderTaskContent.tsx`. **Manually verify exploitability first.** | 2h |
| C2 | Dockerfile silently overrides `TEND_HOST=0.0.0.0` | `Dockerfile:110` | Either (a) remove the override and document that operators must set `TEND_HOST=0.0.0.0` themselves, or (b) keep it but log a startup warning + refuse to serve unencrypted to non-loopback unless `TEND_TRUST_PROXY=true` is explicitly set. Prefer (a). | 1h |
| C3 | No security headers on HTTP responses | `main.rs` (router setup) | Add a `tower_http::set_header` or middleware emitting `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security: max-age=31536000; includeSubDomains` (when `X-Forwarded-Proto: https`), and a strict CSP (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; ...`). Test: ensure SPA still loads. | 4h |
| C4 | WebSocket auth silently disabled when `TEND_AUTH_VERIFY_URL` unset | `ws.rs:78-217` | Refuse to start `/ws` route, OR refuse to start the server, when `auth.required=true` but `verify_url=None`. Loud error at startup. | 1h |

### High

| # | Finding | Where | Fix sketch | Effort |
|---|---------|-------|------------|--------|
| H1 | No startup warning on `TEND_AUTH_REQUIRED=false` | `main.rs:43-119` | Print effective security posture at startup: auth required y/n, bind addr, CORS policy, WS auth y/n, rate limit y/n. Exit-or-warn on the dangerous combinations. | 2h |
| H2 | CORS `*` enables `permissive()` (allows credentials) | `main.rs:64-87` | Either reject `*` outright, or split into explicit origin allowlist with `allow_credentials(false)` when wildcard. Document. | 1h |
| H3 | Rate limiting is global, not per-IP/per-user | `main.rs:127-131` | Configure `tower_governor` with a key extractor (IP from `X-Forwarded-For`, falling back to `Remote-User`). | 2h |
| H4 | No body size limits on mutation endpoints | `routes/mod.rs` | `DefaultBodyLimit::max(N)` per-route or a global layer. Suggested: 1MB for JSON endpoints, 10MB for page bodies. | 2h |
| H5 | Reverse-proxy trust is absolute | `auth.rs:90-128` | Documentation finding: produce an operator guide describing the trust model and the minimum reverse-proxy contract. Optionally: support a shared-secret header (e.g. `X-Proxy-Token`) to prove the proxy was the source. | 4h doc + 2h optional |
| H6 | Zip-import surface (zip-slip + decompression bombs) | `routes/import.rs` | Already validates with `enclosed_name` + `validate_safe_name`. Add: per-entry uncompressed-size cap, total uncompressed cap, file-count cap. | 3h |

### Medium

| # | Finding | Where | Fix sketch | Effort |
|---|---------|-------|------------|--------|
| M1 | No 401 handler in frontend | `App.tsx:124-145` | If `whoami` returns 401, redirect to a `/login` page or show an explicit "session expired" affordance. | 2h |
| M2 | Inline script in `index.html` blocks strict CSP | `packages/web/index.html:16-27` | The script exists for GH Pages SPA redirect — only needed in the demo build. Gate behind `import.meta.env.VITE_DEMO_MODE` at build time, or move to a hashed/nonce'd block. | 1h |
| M3 | No per-endpoint authorization | `routes/mod.rs:33-124` | The current model assumes auth = full access per user. Document this design choice. If multi-user gardens are planned, design a per-resource ACL. | doc only / future |
| M4 | Username validation duplicated | `auth.rs:62-87`, `config.rs:294-306` | Move to `tend-core` as a shared `validate_username` function. | 1h |
| M5 | Encrypted gardens leak metadata via filenames | `encryption.rs:11-12` | Documentation finding: surface this in user-facing docs so the threat model is honest. Optional: per-garden filename-encryption mode. | 1h doc / future feature |
| M6 | Search index plaintext for encrypted gardens (TTL window) | `state.rs:378-419` | Already mitigated with TTL. Document. Optional: encrypt the on-disk index at rest. | 1h doc / future |
| M7 | `TEND_AUTH_DEFAULT_USER` could become a backdoor | `auth.rs:107-123` | When `auth.required=true`, refuse to read `default_user` even if set. Currently it's just unused, but the value lives in config and could be reached by a future bug. | 1h |

### Low

| # | Finding | Where | Fix sketch | Effort |
|---|---------|-------|------------|--------|
| L1 | 75 npm audit findings (all dev/build) | `vite-plugin-pwa` chain | Either remove `vite-plugin-pwa` (if PWA isn't required) or pin a newer version that uses a fresher workbox. | 1h investigation |
| L2 | Stale `@tiptap/*` in node_modules | `node_modules` | `pnpm install --prune` or commit a refreshed lockfile. | 15m |
| L3 | `cargo audit` not in CI | `.github/workflows/` | Add a workflow step. | 30m |
| L4 | Demo session expiry is client-only | `demoStore.ts:236-248` | Acceptable for demo. Document. | 0 |
| L5 | Logging may contain user data | TBD (verify) | Audit `tracing` calls; ensure usernames/content are at debug level or scrubbed at info. | 2h |

---

## 7. Recommended remediation order

A pragmatic single-sprint sequence:

1. **C4** (WS auth refuses to start when misconfigured) — 1h, no UX impact, high signal.
2. **C2** (Dockerfile bind + warning) — 1h, deploy-time correctness.
3. **H1** (startup posture log) — 2h, tells you whether anything else is misconfigured.
4. **C1** (wikilink protocol filter) — 2h after manual verification of exploitability.
5. **C3** (security headers) — 4h, defense-in-depth.
6. **H6** (zip-import resource caps) — 3h, addresses real foot-gun.
7. **H4** (body limits) — 2h.
8. **H3** (per-IP rate limiting) — 2h.
9. **H2** (CORS hardening) — 1h.
10. **L3** (cargo audit in CI) — 30m, lasting hygiene win.

Total ~18.5h for the load-bearing items. Mediums and other Lows can follow on subsequent branches.

---

## 8. Out of scope

- DAST/fuzzing of the running server.
- Penetration test of an actual deployment.
- Threat modeling of features not yet built (multi-user gardens, sharing, publishing, OAuth flows).
- Cryptographic review of `age` parameters (assumed sound).
- Supply-chain analysis beyond `cargo audit` and `npm audit` (e.g., dependency reputation, build provenance).
- Browser threat model for shared/public devices.
