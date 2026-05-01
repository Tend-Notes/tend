# Changelog

All notable changes to Tend are documented in this file.

## [Unreleased]

### Added
- Collapsed-sidebar badge showing count of due/overdue tasks (1-9, or `*` for 10+) with red-faded background; click opens the task manager (49fe77f)
- Full-canvas task manager view (Alt+Shift+T) with view filters (Today / Overdue / Due soon / Starting soon / No due date / All active / Completed) and priority multi-select (High/Medium/Low/None) with theme-colored fills (921f548, d362e58, 3114c6a, 08a2ff4, 2df328d, 351ad4c)
- Expand-to-full-view button in the sidebar todos panel header (79f700e)
- Alt+Shift+T global keyboard shortcut to open the task manager (14efda0)
- Security and privacy posture assessment doc with triaged remediation plan (af16346, 7c005d7)
- Security headers on all HTTP responses: CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, HSTS (9bbc7fc)
- Startup security posture log: prints effective config (auth, bind, CORS, rate limit, body limit) with warnings for unusual values (e5b27a1)
- `safeHref()` helper filters dangerous protocols (`javascript:`, `data:`, `vbscript:`, `file:`) on wikilink href attributes (d539f18)
- `TEND_DEV_ALLOW_INSECURE` env var as an explicit dev-only escape hatch for non-loopback bind without auth, or wildcard CORS (bd67d08, a5a515d)
- `TEND_REQUEST_BODY_LIMIT` env var (default 10 MB) caps request body size on API endpoints; upload retains its 500 MB per-route override (31ac1f6)
- Per-IP rate limit key extractor (`SmartIpKeyExtractor`) so a single client can no longer exhaust the global rate budget (72df10d)
- Zip-import resource caps: `MAX_FILE_COUNT` (50000), `MAX_UNCOMPRESSED_ENTRY` (100 MB), `MAX_UNCOMPRESSED_TOTAL` (2 GB) defend against decompression bombs (9d774fb)

### Changed
- Task fetching consolidated into a new `taskStore` so the collapsed-sidebar badge, sidebar todos panel, and full-canvas task manager share one source of truth (2195847, 9245d6d, 414cb6e, 792b932)
- `pageStore` now tracks `viewingTasks` with `openTaskManager()` / `closeTaskManager()` actions; navigating to a page exits the task manager naturally; deep-linking via `/tasks` URL works (4313dc1, 2dc6cdd, 790d500)
- Wikilink rendering helper for task content extracted to a shared module so both `SidebarTodos` and `TaskManagerPage` use it (351ad4c)
- Workspace version bumped to 0.7.0 (5f292b1)
- Server refuses to start with `TEND_AUTH_REQUIRED=true` if `TEND_AUTH_VERIFY_URL` is unset, closing a silent WebSocket auth bypass (55cb0b0)
- Server refuses to start with `TEND_AUTH_REQUIRED=false` on a non-loopback bind unless `TEND_DEV_ALLOW_INSECURE=true` (bd67d08)
- CORS wildcard (`TEND_CORS_ORIGINS=*`) is rejected unless `TEND_DEV_ALLOW_INSECURE=true`; permissive path now sets `allow_credentials(false)` (a5a515d)
- Production frontend build strips the GitHub-Pages SPA-redirect inline script so the strict CSP can apply (4b4cabc)
- Dockerfile annotated to document that `TEND_HOST=0.0.0.0` requires a reverse proxy in production (bd67d08)

### Fixed
- Env-var-touching tests in `crates/tend-server/src/config.rs` now serialize via a shared mutex so they're reliable under `--test-threads=8` (a9e3243)

### Breaking
- **Docker upgrade requires new env var.** Existing Docker deployments that set `TEND_AUTH_REQUIRED=true` (default) but did NOT set `TEND_AUTH_VERIFY_URL` will refuse to start after upgrade. Set `TEND_AUTH_VERIFY_URL` to your reverse proxy's auth verification endpoint (e.g. `https://authelia.example.com/api/verify`), or for single-user local deploys set `TEND_AUTH_REQUIRED=false` with `TEND_AUTH_DEFAULT_USER=<your-username>`. Closes a silent WebSocket auth bypass; see Dockerfile comments for full setup.

## [0.1.1] - 2026-03-30

Note: Version was incorrectly labeled 0.1.1. The actual version is v0.1.20260330-203511.

### Added
- Home icon in collapsed sidebar for quick navigation to today's journal

## [0.1.0] - 2026-03-30

### Fixed
- Blank screen on initial page load: app now shows "Loading..." until initialization completes
- 500 error when page/meeting names contain colons (e.g., "1:1 Jamie Parker")
- Typewriter scroll bottom padding on desktop
- Multi-block delete on subsequent selections
- Shift+Arrow block selection + Delete
- Drag-to-select starting from outside editor container
- Two-click activation: focus editor on first click
- Blue outline on multi-block selection container focus
- Scroll title overlapping page content
- Editor mouse interaction bugs
- Typewriter scroll targeting wrong scroll container

### Added
- Cross-platform filename encoding for page/sheet names (`:` `<` `>` `"` `|` `?` `*` `\` percent-encoded)
- Backwards-compatible file reading (falls back to raw filenames for pre-encoding files)
- Input validation for encrypted filesystem operations (was missing)
- Control character rejection in page name validation
- GitHub Actions workflow to build and push Docker image to GHCR
- Scroll title that appears when page title scrolls out of view
- Multi-block selection and delete
- Demo mode with IndexedDB storage

### Security
- Added validate_safe_name calls to encrypted filesystem (was unvalidated)
- Removed overzealous Windows drive letter check that incorrectly blocked legitimate names
