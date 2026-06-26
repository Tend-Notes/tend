# Fixes — `sheet-unification` branch review

Review of `feat/sheet-unification` (commits `ba84b2d`, `80005d0`) against `trunk`.
Build is clean and tests pass (42 `tend-core` + 24 `tend-storage`). The core
refactor — replacing the `save_by_date` boolean with a 3-value `Organization`
enum and collapsing three storage paths into one — is sound and well-tested.

The items below are follow-ups, ordered by severity.

---

## 1. Path-traversal regression: directory validation is now conditional (security)

**Severity:** Medium (cross-garden access in multi-user mode); Low (self-harm in
single-user self-hosting).

**Where:**
- `crates/tend-storage/src/fs.rs` — `read_sheet` / `write_sheet` / `delete_sheet` / `sheet_exists`
- `crates/tend-storage/src/encrypted_fs.rs` — same four methods
- `crates/tend-server/src/routes/gardens.rs:852` — `update_content_types`

**What changed.** Before this branch, the storage layer always ran
`validate_safe_name(&content_type.directory)`, and the built-in `page`/`journal`
paths ignored the configured directory entirely (hardcoded `pages` / `journals`).
After the refactor, the directory is interpolated into the on-disk path via
`sheet_path`, but `validate_safe_name(&content_type.directory)` is **skipped**
whenever `name_includes_directory()` is false — i.e. for `page`, `journal`, and
any date-named type:

```rust
if content_type.name_includes_directory() {
    validate_safe_name(&content_type.directory)?;
}
```

**Why it matters.** Routes (`create_sheet`, `get_sheet`, `list_sheets`) pass the
**config-loaded** content type directly into these storage methods. The config is
user-controlled: `update_content_types` validates id/directory *uniqueness* but
never validates the `directory` *string* itself. So an authenticated user can set
`page.directory = "../../something"`. The `..` would normally be rejected by
`validate_safe_name` — but that check is exactly the one now bypassed for this
type. The result is a read/write outside the garden root.

This is a regression: pre-branch, `write_page`/`read_page` ignored the configured
directory, so the vector did not exist.

- Single-user self-hosted: effectively self-harm.
- Multi-user (`load_user_content_types(username)`, per-user gardens): a
  `../<other-user>/...` directory could read or write into another user's garden.

**Fix (defense in depth — do both):**

1. Make directory validation unconditional in the four storage methods (drop the
   `if content_type.name_includes_directory()` guard around the directory check;
   keep the name check as-is). The cost is one extra string scan.
2. Validate every `ct.directory` with `validate_safe_name` in
   `update_content_types` before persisting, so a malicious directory never
   reaches disk config in the first place.

---

## 2. `directory` is never validated at config-write time

**Severity:** Low (root cause of #1; worth fixing independently).

**Where:** `crates/tend-server/src/routes/gardens.rs:852` (`update_content_types`).

The handler checks that `page` and `journal` types exist, rejects duplicate ids,
and rejects duplicate directories — but applies no character/traversal validation
to the `directory` (or `id`) fields, even though `directory` flows into
filesystem paths throughout the codebase (`reindex.rs`, `import.rs`, `sheets.rs`,
both storage managers).

**Fix:** Run `validate_safe_name` on each `ct.directory` (and ideally `ct.id`)
in `update_content_types`, returning `BadRequest` on failure.

---

## 3. `Organization::DateNamed` admits an unreachable, undefined state

**Severity:** Low (latent; not reachable today).

**Where:** `crates/tend-core/src/content_type.rs`.

The enum allows `DateNamed` for any content type, but only `id == "journal"` gets
the journal-specific behavior (auto-create-on-miss, `is_journal`, human title).
A hypothetical custom `DateNamed` type would parse its name as a date, skip
directory validation (see #1), and behave half-like a journal — a state with no
defined semantics.

It is not reachable now: the wire layer only derives `DateNamed` for
`id == "journal"`, and there is no UI to set it. But the type system now permits
it.

**Fix (pick one):**
- Document that `DateNamed` is journal-only and assert/guard it at construction, or
- Generalize the journal behaviors to key on `is_date_named()` rather than
  `id == "journal"`, so a custom date-named type is well-defined.

---

## 4. Frontend still speaks `saveByDate` only

**Severity:** Low (tracked migration gap; the compatibility bridge handles it).

The web frontend still reads/writes `saveByDate` (e.g.
`packages/web/src/types/index.ts`, `stores/settingsStore.ts`, `lib/api.ts`, and
others). The `ContentTypeWire` dual-emit keeps this working, but the frontend
cannot express the `DateNamed` vs `DateFoldered` distinction.

**Action:** Migrate the frontend to `organization` in a later stage. Until then,
the dual-emit bridge in `ContentTypeWire` is load-bearing and must not be removed.

---

## 5. Journal read/write directory asymmetry

**Severity:** Low (latent; harmless today).

**Where:** `write_sheet` (both managers).

Journal **writes** use the hardcoded `journal_path` (ignoring
`content_type.directory`), while journal **reads** use `sheet_path` (which honors
`content_type.directory`). These agree only because the journal directory is
always `"journals"`. If a journal type ever carried a different directory, writes
and reads would diverge.

**Fix:** Route journal writes through `sheet_path` as well, or assert the journal
directory is `"journals"`.
