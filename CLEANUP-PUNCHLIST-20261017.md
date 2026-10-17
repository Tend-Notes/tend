# Cleanup punchlist — 2026-10-17 (duplication, inefficiency, dead code)

**Audience:** an engineer (or Claude) executing these fixes. Read top to bottom
before starting. Source: a duplication/inefficiency review of the Rust server
(`crates/`) and web client (`packages/web/src`) on 2026-10-16. Security was out
of scope for that review and is out of scope here.

Every item below is **new** relative to the other tracking files. Before
expanding any item's scope, check you are not re-doing work already recorded in:

- `PUNCHLIST-20261015.md` (lint config, e2e failures, e2e isolation)
- `PERF-PUNCHLIST-20260711.md` (untracked, local-only — PERF-01…24)
- `REVIEW-REMEDIATION-20261015.md` (untracked, local-only — security + quality
  phases; its Phase 6 cleanup list overlaps this territory but not these items)
- `REWRITE-BACKLOG.md`

If one of those files is absent in your checkout (two are deliberately
untracked), proceed; the item descriptions here are self-contained.

## Ground rules

- **Branch per item** off `trunk`, named `cleanup/<id>-<slug>` (e.g.
  `cleanup/cln-01-wikilink-cache`). Never commit on trunk. Never merge to
  trunk — merging is the owner's call. Never delete a branch.
- **No attribution trailers** in commits (no Co-Authored-By, no tool mentions).
- One logical fix per commit, message prefixed with the item ID
  (`CLN-01: cache the wikilink sheet listing`).
- **Verification baseline for every item**: `cargo test --workspace`,
  `cargo clippy --workspace -- -D warnings`,
  `pnpm --filter web build` (tsc is the only working static check —
  `pnpm lint` exits 2 on a missing eslint config, see PUNCHLIST-20261015 §1).
- **E2e**: run the scripts named per item via the pattern in
  PUNCHLIST-20261015 ("How to reproduce the e2e results") against a disposable
  `TEND_BASE_DIR`. Twelve checks already fail on trunk (PUNCHLIST-20261015 §2),
  so the gate is **no regression against a fresh trunk baseline**, not
  all-green. Capture the baseline for the named scripts before editing.
- Items are **behavior-identical refactors unless the item says otherwise**.
  CLN-04, CLN-08, CLN-10, and CLN-12 fix latent divergences and say exactly
  what changes.
- When an item says "extract a shared helper", the helper replaces **all**
  listed copies — grep for every site before you start, and again after.
- If a fix balloons past its stated effort or needs a design decision not
  written here, stop and flag it to the owner.

Effort key: **S** <1h · **M** a few hours.

---

## Tier 1 — ranked findings

### CLN-01 · WikiLink autocomplete refetches the entire garden on every `[[` · S–M

- **Problem**: `packages/web/src/components/editor/WikiLinkPopup.tsx:24-37`
  loads all sheets for all content types in a mount effect
  (`Promise.all(contentTypes.map(ct => api.sheets.list(ct.id)…))`). The popup
  is mounted conditionally at
  `packages/web/src/components/editor/outline2/OutlineEditorV2.tsx:200` only
  while a `[[` trigger is live, so the "on mount" effect reruns on **every
  `[[` typed**: C parallel HTTP requests returning every sheet meta, each of
  which is a whole-garden read+parse server-side (PERF-02). No cache, no
  AbortController — a closed popup's responses still land in state.
- **Fix**: cache the flattened listing (module-level or a store, keyed by
  content type), fetched once per editor session and invalidated on page save
  and garden switch (or a short TTL, ~30s). Ignore/abort responses after
  unmount.
- **Verify**: e2e `packages/web/e2e/editor-v2-wikilink-autocomplete.mjs`
  matches its trunk baseline. Manually (or via the e2e harness's network
  logging): typing `[[` three times in a row issues the listing fetch once,
  and a save followed by `[[` refetches.

### CLN-02 · `uuidPlugin` walks the whole document on every keystroke · S–M

- **Problem**:
  `packages/web/src/components/editor/outline2/uuidPlugin.ts:15-28` gates only
  on `docChanged`, then runs `newState.doc.descendants` plus a Set build over
  the full document. Plain typing cannot introduce a missing or duplicate
  uuid — only structural steps (split, paste, move) can — so on a B-block page
  every keystroke pays an O(B) walk, stacked on the full decoration rebuild
  already recorded as PERF-12.
- **Fix**: bail early when every step in the transactions is a text-only
  replace whose slice contains no `list_item` node; otherwise (or as an
  alternative implementation) restrict the scan to the ranges touched by
  `tr.mapping`. Minting behavior for split/paste/move must be unchanged.
- **Verify**: e2e `editor-v2-structural.mjs`, `editor-v2-split-metadata.mjs`,
  `editor-v2-move-collapse.mjs` match their trunk baselines (note: some of
  these already have failing checks on trunk — compare, don't expect green).
  Add a unit-style check if practical: a text-only transaction on a large doc
  does not call `descendants` (e.g. instrument temporarily and assert in a
  manual run).

### CLN-03 · Dead client code from the V1-editor removal (~500 lines) · M

All verified zero importers across `packages/web/src` and `packages/web/e2e`.

- **Problem / Fix** (sub-items; one branch is fine, separate commits):
  1. `components/ui/ActivityLog.tsx` (105 lines) — render site deleted in
     commit `2c7ba40`; delete the file. This makes
     `stores/activityLogStore.ts` write-only (`pageStore.ts` ×4 call sites and
     `hooks/useAutoCommit.ts:41` still `addEntry()` into it). **Owner
     decision**: recommended to delete the store and its `addEntry` call sites
     too (~60 lines); if the owner wants the log kept for a future UI, delete
     only the component and note that the store is write-only.
  2. `components/ui/BlockContextMenu.tsx` (78 lines) — only caller was deleted
     with the V1 editor (`bcf1935`). Delete.
  3. `components/editor/contentRenderer.ts:297-439` — `renderContent`, the
     "DOM elements for CodeMirror widgets" renderer (~149 lines). CodeMirror
     is no longer in `package.json`; V2's `decorations.ts:13` imports only
     `parseContent`. Delete. Do **not** delete `renderContentReact` or its
     `BlockReferenceDisplay` support block (`:445-586`) — they have no callers
     today but are the named consolidation target in
     REVIEW-REMEDIATION-20261015 (three-renderer consolidation); they are
     reserved, not dead.
  4. `styles/globals.css`: delete `.block-ref` (`:346-…`, commented "legacy")
     and `.seed-dormant`/`[data-seed-editor]` (`:89-92`, `:907-925`) now
     (~35 lines; `seed-dormant` has zero emitters, V2 emits `pm-blockref`).
     The `.block-reference*` family (~125 lines) is emitted only by the dead
     `renderContent` and the reserved `renderContentReact` — delete it **only
     together with** the renderer-consolidation decision above; otherwise
     leave with a comment pointing here.
  5. Small zero-caller exports, delete each: `lib/dateUtils.ts:78 isOverdue`,
     `:91 isDueToday`; `lib/themes.ts:267 getAllThemes`,
     `:292 getThemeError`; `lib/demoStore.ts:263 fullReset`;
     `stores/settingsStore.ts:60 usesDateFolder`.
  6. While in `contentRenderer.ts`: remove the stray NUL byte (~offset 3693).
     It makes grep/rg treat the file as binary, which hides it from searches.
- **Verify**: `pnpm --filter web build` passes; `rg -nw` for each deleted
  symbol returns nothing; `rg --files-without-match .` no longer flags
  `contentRenderer.ts` as binary (`file contentRenderer.ts` → text). Full e2e
  run matches trunk baseline (no script touches any of this).

### CLN-04 · `stabilize` reimplements `sheet_path` — and the copy is wrong · M

- **Problem**: `crates/tend-server/src/routes/reindex.rs:219-250` hand-builds
  on-disk paths (journal / page / date-foldered / other) instead of using the
  authority `sheet_path` (`crates/tend-storage/src/fs.rs:402-422`,
  `encrypted_fs.rs:373`). The copy never applies `encode_filename`, so sheets
  with encoded filenames fail the raw `tokio::fs::read_to_string` at
  `reindex.rs:253` and are counted `failed`; in an encrypted garden the raw
  read returns ciphertext, so every file "lacks a footer" or fails to parse.
  Separately, stabilize's Phase 2 (`reindex.rs:310-354`) repeats verbatim the
  five-rebuild sequence (`rebuild_link_index` → `rebuild_search_index` →
  `rebuild_block_index` → `rebuild_tag_index` → `rebuild_todo_index`) that
  `reindex()` already runs at `reindex.rs:75-144`.
- **Fix**: stabilize only needs "does this sheet's file have a footer" —
  expose a `read_raw` (or `has_footer`) method on the file managers built on
  `sheet_path`, dispatched like `read_sheet` so encrypted gardens decrypt.
  Delete the inline path building. Extract the five-rebuild block into one
  helper (e.g. `rebuild_all_indices(&garden, &content_types)` in
  `routes/helpers.rs` or `state.rs`) called from both `reindex` and
  `stabilize`.
- **Behavior change (intended)**: encoded-filename sheets and encrypted
  gardens are now counted correctly by stabilize instead of being reported
  failed/footer-less.
- **Verify**: `cargo test --workspace`. Add a test (or extend fs.rs tests):
  a sheet whose name requires `encode_filename` round-trips through the new
  `read_raw`. Manual: run reindex + stabilize against a garden containing an
  encoded-name sheet and (separately) an encrypted garden; stabilize reports
  success where trunk reports failures.

### CLN-05 · `navigateToPage` / `navigateToJournal` duplicate the load sequence · M

- **Problem**: `packages/web/src/stores/pageStore.ts:384-505` vs `:507-569`.
  The pre-flight (`flushPendingSave`, `lastSaveTimestamp = 0`, the
  loading-state `set`, `useSyncStatusStore…reset()`), the ~25-line
  draft-recovery block (`:422-446` vs `:528-553`), `recordSheetAccess`, and
  the `window.history.pushState` tail are verbatim in both. Real differences:
  which fetch runs, and the pages-only 404→create fallback. (Distinct from
  the save-path triplication recorded in REVIEW-REMEDIATION 4.5.)
- **Fix**: one internal `loadSheet(fetcher, { urlType, name, on404? })`
  holding pre-flight, draft check, state commit, recent-sheet recording, and
  pushState; `navigateToPage` and `navigateToJournal` become thin wrappers.
  ~100 lines consolidated. Callers unchanged.
- **Verify**: nearly every e2e script navigates — run the full suite and
  compare against the trunk baseline. Manually check draft recovery still
  triggers (edit, kill the save, reload) on both a page and a journal.

### CLN-06 · Root-blocks recomputation triplicated — and quadratic · S–M

- **Problem**: `packages/web/src/stores/pageStore.ts:657-700`
  (`updateCurrentPage`), `:1072-1099` (`updateTemplate`), `:1261-1288`
  (`updateImportError`) all open with the same blockMap/rootUuid loop and the
  same `rootBlocksHint` branch
  (`finalRoots.includes(uuid)` inside a loop over all roots). `includes` /
  `indexOf` in loops is O(R²), and `updateCurrentPage` runs on every debounced
  editor save (400 ms pause — `OutlineEditorV2.tsx:73-78`); a flat 1,000-root
  journal ≈ 10⁶ uuid string comparisons per save.
- **Fix**: extract `computeRootBlocks(blocks, rootBlocksHint, existingRoots,
  opts?)` returning `{ blockMap, finalRoots }`, with Set-based membership
  tests throughout. The insert-after-former-parent fallback
  (`:686-699`) is an option used only by `updateCurrentPage` — preserve its
  ordering semantics exactly (it splices after the former parent's index).
  All three call sites use the helper.
- **Verify**: e2e `editor-v2-structural.mjs`, `editor-v2-move-collapse.mjs`
  match trunk baselines. Template and import-error editors have no e2e
  coverage — exercise both by hand (edit a template, edit an import error,
  confirm block order survives).

### CLN-07 · `demoApi.ts` re-declares api.ts converters and nine types · S

- **Problem**: `lib/api.ts:222-246` vs `lib/demoApi.ts:30-54` — `BlockData`,
  `blockToApiFormat`, `pageBlocksToApiFormat` are byte-identical copies.
  demoApi also re-declares `IndexStatus` (`:290`), `SearchStatus`
  (`:292-298`), `SearchResponse` (`:300-303`), `WikilinkTargetsResponse`
  (`:327-329`), `TagInfo` (`:418-421`), `Garden` (`:574-581`),
  `GardensResponse` (`:583-587`), `ContentType` (`:678-684`),
  `WhoamiResponse` (`:771-773`) — all existing in api.ts. `ContentType` has a
  third copy at `stores/settingsStore.ts:50-56`. The demoApi copies are dead
  exports (nothing imports them from demoApi), and `demoApi.importApi.logseq`
  (`:848-850`) has no caller. demoApi already type-imports
  `TaskItem`/`TaskList` from api.ts (its own comment: "single source of
  truth"), so the import direction is established and circular-safe.
- **Fix**: in demoApi, replace local declarations with
  `import type { … } from './api'`; delete `blockToApiFormat`,
  `pageBlocksToApiFormat`, and `importApi.logseq` there. Settle `ContentType`
  on one canonical module (settingsStore is what `lib/name.ts`, pageStore,
  and CommandPalette import today — keeping settingsStore canonical and
  having api.ts/demoApi import it is the smaller change; flag if the
  dependency direction looks wrong in practice).
- **Verify**: `pnpm --filter web build`. Demo mode has no e2e coverage —
  build with `VITE_DEMO_MODE` and click through page load, search, task list
  to confirm the demo still functions.

### CLN-08 · `build_sheet_page_name` reimplements `tend_core::qualify_name` · S

- **Problem**: `crates/tend-server/src/routes/sheets.rs:32-44` duplicates
  `crates/tend-core/src/name.rs:46-58` (`qualify`, exported as
  `qualify_name` — self-described "single authority" and already used by
  tend-storage at `fs.rs:179/238/651`, `encrypted_fs.rs:649`). The copies
  diverge: for a date-foldered type with `date == None`, the sheets.rs copy
  defaults to **today**, while `qualify_name` omits the date segment — the
  same sheet gets different names depending on which function ran. Related:
  `tend_core::parse_name` / `ParsedName` (`name.rs:93-115`, re-exported at
  `lib.rs:22`) has zero callers anywhere.
- **Fix**: resolve the date before qualifying (the create path already does —
  `sheets.rs:276-280`), call `tend_core::qualify_name`, delete
  `build_sheet_page_name`. Call sites: `sheets.rs:302, 420, 471/482`. Keep
  the existing effective behavior (today-default) by resolving `None` →
  today **at the call sites** before calling `qualify_name` — the point is
  one authority, not a behavior change. For `parse_name`: either point the
  blocks.rs name-parsing consolidation recorded in REVIEW-REMEDIATION Phase 6
  at it, or delete the export; owner's call — flag, don't guess.
- **Verify**: `cargo test --workspace` (name.rs tests unaffected). Create /
  update / delete a date-foldered sheet with and without an explicit date via
  the API; names in search/backlinks/tags match what storage wrote.

### CLN-09 · Centered modal/backdrop shell hand-rolled in six-plus dialogs · M

- **Problem**: byte-identical three-element shell (`fixed inset-0 z-50 …` /
  `overlay-backdrop fixed inset-0 bg-black/50 animate-fade-in` /
  `overlay-content relative bg-base-01 rounded-lg shadow-2xl border …`) in
  `ui/ConflictResolutionDialog.tsx:16-18`, `ui/DraftRecoveryDialog.tsx:15-17`,
  `ui/SessionExpiredOverlay.tsx:27-29`, `ui/KeyboardHelp.tsx:44-52`,
  `search/SearchPanel.tsx:87-95`; near-identical in
  `ui/LogseqImportDialog.tsx:171-179`; loose variants in `WorkTimerBanner.tsx`
  (`:198-199`), `DemoWelcomeOverlay.tsx` (`:26-27`), `UnlockGardenDialog.tsx`
  (`:29-35`). The idiom has drifted (fade vs none, `black/50` vs `/60` vs
  `base-00/80`, click-away vs none).
- **Deliberate divergence, preserved**: `CommandPalette.tsx` uses
  `Command.Dialog` (cmdk requires it) — leave it alone.
- **Fix**: one `ModalShell` component (props: `onBackdropClick?`,
  `align: 'center' | 'top'`, `maxWidth`, optional `panelClassName`) used by
  the six main sites; fold in the loose variants only where their styling
  difference is not intentional (when unsure, keep their current backdrop
  values via `panelClassName`/props rather than normalizing — flag intended
  look changes to the owner). UnlockGardenDialog's no-dismiss mode = omit
  `onBackdropClick`.
- **Verify**: e2e `auth-expiry.mjs` (SessionExpiredOverlay),
  `garden-locked-unlock.mjs` (UnlockGardenDialog if folded in) match
  baselines. Visually open each dialog (conflict, draft recovery, keyboard
  help, search, Logseq import) and confirm placement/backdrop/dismissal are
  unchanged.

### CLN-10 · `accept_import_error` hand-rolls index updates, skips tags/todos · S

- **Problem**: `crates/tend-server/src/routes/import.rs:986-1015` repeats the
  link/search/block index sequence that
  `routes/helpers.rs:179-232` (`update_all_indices_with_content_type`)
  already implements — **minus the tag and todo index updates** the helper
  also performs. It also indexes under the bare `file_name` rather than
  `page.name`. Sibling of the recorded `create_page` hand-roll
  (REVIEW-REMEDIATION 4.4), at a second site. Same file repeats a
  name-sanitizing `chars().filter(…)` three times (`:680-685`, `:915-919`,
  `:923-928`).
- **Fix**: replace `import.rs:986-1015` with one call to
  `update_all_indices_with_content_type(&garden, &page, "sheet",
  &content_type, sheet_date)`. Extract `sanitize_import_name(&str) -> String`
  for the three filter copies.
- **Behavior change (intended)**: an accepted import containing `#tags` or
  `TODO` blocks now appears in `/tags` and `/todos` without a full rebuild,
  and is indexed under its qualified page name.
- **Verify**: `cargo test --workspace`. Manual: import a file that lands in
  import-errors, accept it with content containing a `#tag` and a `TODO`;
  both show up in `/tags` and `/todos` immediately; search finds the page
  under its qualified name.

---

## Tier 2 — below the cut (smaller payoff; all verified)

### CLN-11 · Two calendars duplicate the month-grid machinery · M

- **Problem**: `ui/DatePickerPopover.tsx` and `ui/HeatmapCalendar.tsx` copy
  each other above the already-shared `lib/calendarUtils.ts`: month
  navigation verbatim (`DatePickerPopover.tsx:50-71` vs
  `HeatmapCalendar.tsx:89-111`), day-cell loop (`:90-96` vs `:125-131`),
  header JSX with identical SVG paths (`:178-206` vs `:151-179`), DAY_NAMES
  grid, `today` memo, and day-button classes. HeatmapCalendar already runs as
  a plain date picker (`heatmap={false}`, `CommandPalette.tsx:474-480`), so
  the app ships two date-picker implementations.
- **Fix**: a `MonthGrid` base owning today/viewYear/viewMonth state, nav
  header, day-names row and cell loop, with a `renderDay(day, dateStr,
  isToday)` render prop. DatePicker keeps its quick-action row (`:142-175`)
  and viewport positioning (`:98-121`); Heatmap keeps its journal fetch,
  intensity shading, and legend.
- **Verify**: e2e `palette-link-or-create.mjs` (date filter),
  `editor-v2-split-metadata.mjs`, `task-manager-edit.mjs` vs baselines
  (several have pre-existing failures — compare). Visually: both calendars
  navigate months and pick dates as before.

### CLN-12 · `ws.rs` re-implements auth.rs username extraction · S

- **Problem**: `crates/tend-server/src/ws.rs:78-102` (`extract_username`,
  comment admits "matches auth.rs logic") duplicates
  `crates/tend-server/src/auth.rs:92-129`
  (`extract_username_from_headers`). Drift: auth.rs trims whitespace and
  validates inline; ws.rs does neither (validates later at `ws.rs:283`,
  never trims), so a `"alice "` header yields different identities on HTTP
  vs WS.
- **Fix**: make `extract_username_from_headers` `pub(crate)`; ws.rs calls it
  and maps `Err` → `None`; delete `ws::extract_username`.
- **Behavior change (intended)**: WS usernames are now trimmed/validated
  identically to HTTP.
- **Verify**: `cargo test --workspace` (auth.rs username tests). Manual: WS
  connect in dev mode still authenticates; a padded user header resolves to
  the same identity over HTTP and WS.

### CLN-13 · `user.rs` prefs/state handlers are the same two functions twice · S

- **Problem**: `crates/tend-server/src/routes/user.rs` — `get_prefs`
  (`:23-45`) vs `get_state` (`:92-114`) and `put_prefs` (`:50-87`) vs
  `put_state` (`:119-156`) differ only in the path helper and log noun; the
  putters repeat the ensure-dir / write / chmod-0600 / NO_CONTENT sequence
  verbatim. The `#[cfg(unix)]` chmod block is also copied in
  `routes/gardens.rs:334-340` (`save_user_gardens_config`) and
  `config.rs:616-621` (`Config::save` — note CLN-18 deletes `Config::save`,
  so handle ordering).
- **Fix**: `read_user_json(path) -> Response` and
  `write_user_json(username, path, value) -> Response` helpers; the four
  handlers become one-liners. Optionally a `write_private_json(path,
  content)` that absorbs the gardens.rs chmod copy.
- **Verify**: `cargo test --workspace`. Manual: GET/PUT both endpoints
  round-trip; written files are mode 0600.

### CLN-14 · `switch_garden` vs `switch_garden_encrypted` choreography · S

- **Problem**: `crates/tend-server/src/state.rs:1357-1400` vs `:1403-1457`
  share ~25 lines byte-for-byte: stop watcher → build `GardenState` → start
  watcher → swap garden → swap watcher handle. Divergence is only the
  constructor (`GardenState::new` vs `new_encrypted`) and the encrypted
  path's trailing `rebuild_after_unlock`.
- **Fix**: private `async fn install_garden(&self, dir: PathBuf, new_garden:
  GardenState)` doing stop/start/swap; both public fns become validate →
  construct → `install_garden` (+ `rebuild_after_unlock` where it exists
  today). While there, `start_file_watcher`'s inline `match file_manager`
  re-derivation of pending writes (`state.rs:1153-1156`) can use the existing
  `UnifiedFileManager::pending_writes()` (`state.rs:106-111`).
- **Verify**: `cargo test --workspace`; e2e `garden-locked-unlock.mjs` (or
  the current lock-badge script) vs baseline; manual switch between a plain
  and an encrypted garden, confirm file-watcher events still arrive after
  each switch (edit a file on disk, see the update).

### CLN-15 · Search-index disk GC pointed at the wrong directory · S

- **Problem**: `crates/tend-server/src/main.rs:78` passes
  `config.data_dir` (which defaults to the **active garden** directory,
  `config.rs:339-363`) to `start_search_index_gc_task`, but the sweep looks
  for `<dir>/users` (`state.rs:1821-1827`) while users actually live at
  `config::base_dir().join("users")` (`config.rs:289-291`). With default
  config the hourly sweep finds nothing, ever — `run_search_index_gc` and
  `gc_user_search_indices` (`state.rs:1848-1938`) are unreachable in a
  standard deployment.
- **Fix (recommended)**: pass `config::base_dir()` at `main.rs:78` — one
  line; the sweep then actually cleans legacy on-disk indexes for users who
  never reopen their garden. Alternative (owner's call): delete the disk
  sweep (~120 lines + its `gc_tests` at `state.rs:1990`), since
  `GardenState::new_with_file_manager` (`state.rs:421-432`) already removes
  legacy on-disk indexes whenever an encrypted garden is opened. Flag which
  was chosen in the commit message.
- **Verify**: if fixed: plant a fake expired index under
  `<base>/users/<u>/…`, run one GC pass (shorten the interval in a test),
  assert removal. If deleted: `cargo test --workspace` after removing the
  test with the code.

### CLN-16 · Task filter predicates re-typed in three components · S

- **Problem**: `stores/taskStore.ts:33-55` exports pure selectors
  (`isCompleted` logic, `selectToday`, `selectOverdue`, …), but:
  `sidebar/SidebarTodos.tsx:36-38` re-declares `isCompletedStatus` and
  re-derives today/overdue inline in its filter memo (`:69-88`);
  `sidebar/Sidebar.tsx:78-93` (`taskCounts`) re-implements
  `selectToday(tasks).length` / `selectOverdue(tasks).length`;
  `tasks/TaskManagerPage.tsx:79` re-declares the completed check (the rest of
  that file already uses the selectors). Drift in one site (e.g. a new
  status) silently desynchronizes counts from lists. (The task-keyword *list*
  divergence is separately recorded — REVIEW-REMEDIATION 4.6; this item is
  the predicates.)
- **Fix**: export `isCompleted`/`isActive` from taskStore; SidebarTodos maps
  its filter mode → selector; Sidebar uses the selectors' lengths;
  TaskManagerPage imports the predicate.
- **Verify**: e2e `sidebar-task-view.mjs`, `task-manager-edit.mjs`,
  `task-timer-on-doing.mjs` vs baselines (task-manager-edit has pre-existing
  failures — compare). Sidebar counts equal the filtered list lengths.

### CLN-17 · userSync POSTs unchanged payloads on caret movement · S

- **Problem**: `lib/userSync.ts:244` subscribes `saveStateToServer` to the
  whole uiStore, but `buildState()` (`:148-163`) serializes only
  sidebar/backlinks/graph/recents/tags/work-session — not
  `lastFocusedBlockUuid`, which `OutlineEditorV2.tsx:100` writes every time
  the caret crosses a block boundary. Each 1s editing pause POSTs the full
  UI-state JSON byte-identical to the last one. Prefs side: `App.tsx:170-173`
  calls `setContentTypes` outside the `isLoadingFromServer` guard, and
  `useSettingsStore.subscribe(savePrefsToServer)` (`:242`) fires although
  `buildPrefs()` (`:118-137`) contains no contentTypes — one guaranteed
  no-change `savePrefs` POST per cold load / garden switch.
- **Fix**: snapshot-compare — keep the last-sent serialized payload and skip
  the POST when equal (covers both state and prefs); move the one-shot
  `setContentTypes` inside the loading guard. (Selector-based subscriptions
  are the recorded PERF-11 work — don't start that here.)
- **Verify**: network panel: caret movement during editing produces no
  `user/state` POSTs; toggling the sidebar produces exactly one; cold load
  produces no `user/prefs` POST when nothing changed.

### CLN-18 · Dead Rust singles (zero callers, verified by grep) · S

- **Problem / Fix** — delete each:
  - `AppState::broadcast` — `state.rs:1754-1760` (superseded by
    `broadcast_to_user` / `broadcast_garden_switched`).
  - `GardenState::delete_search_index` — `state.rs:536-546`.
  - `Config::save` — `config.rs:607-624` (config is read-only at runtime).
    Removes one of the three chmod copies noted in CLN-13.
  - `base_data_dir` — `config.rs:366-369` (already `#[deprecated]`, zero
    callers).
  - `TodoIndex::index_sheet` (`indices.rs:231`), `remove_regular_page`
    (`:287`), `remove_journal` (`:292`) — production uses only
    `index_page`/`remove_page`. `index_regular_page` (`:219`) and
    `index_journal` (`:225`) are used only by this file's own tests — either
    keep them as test helpers or rewrite those tests against `index_page`.
  - `page_path` — `tend-storage/src/fs.rs:277`.
  - tend-core zero-caller methods: `page.rs:140 get_block_mut`,
    `:145 blocks_in_order`, `:175 all_block_refs`, `:187 all_tags`;
    `block.rs:77 is_done`.
- **Verify**: `cargo test --workspace` and
  `cargo clippy --workspace -- -D warnings` after each deletion; `rg -nw`
  per symbol returns nothing.

---

## Suggested order

1. **CLN-03** and **CLN-18** first — pure deletions, zero risk, and they
   shrink the grep surface for everything after.
2. **CLN-01**, **CLN-02**, **CLN-06** — the per-keystroke/per-save costs.
3. **CLN-07**, **CLN-08**, **CLN-10**, **CLN-12** — small consolidations,
   three of which also fix latent divergences.
4. **CLN-04**, **CLN-05** — the two larger refactors; do them fresh, not at
   the end of a long session.
5. **CLN-09**, **CLN-11**, **CLN-13…17** as fill-in.

## Coordinate with the other punchlists

- CLN-02 and PERF-12 touch the same editor event path; CLN-17 borders
  PERF-11 (store-subscription hygiene) — do the snapshot-compare here, leave
  selector conversion to PERF-11.
- CLN-03.3/3.4 are bounded by REVIEW-REMEDIATION's three-renderer
  consolidation: `renderContentReact` is reserved, and the `.block-reference*`
  CSS goes with that decision, not this one.
- CLN-13 and CLN-18 both touch `Config::save` — if CLN-18 lands first, the
  chmod-helper scope in CLN-13 shrinks to gardens.rs + user.rs.
