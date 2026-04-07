# Unify Sheet Handling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate all separate page/journal/sheet code paths. Every function that iterates "all content" should use a single loop over all content types via `list_sheets()`.

**Architecture:** Centralize the "load a sheet by its metadata" pattern into a single helper in state.rs. All rebuild/index/query functions call this helper instead of branching on content type ID. Frontend saves and conflict resolution route through the sheets API uniformly.

**Tech Stack:** Rust (Axum), TypeScript (React/Zustand)

---

### Task 1: Create centralized sheet loading helper in state.rs

**Files:**
- Modify: `crates/tend-server/src/state.rs`

The branching pattern (journal needs date, page uses name, custom needs directory stripping) appears in every function. Centralize it once:

```rust
/// Load a page/sheet from its metadata, regardless of content type.
/// This is the ONE place that handles the journal/page/custom branching.
pub async fn load_sheet_from_meta(
    &self,
    ct: &ContentType,
    meta: &PageMeta,
) -> Option<Page> {
    if ct.id == "journal" {
        let date = meta.journal_date?;
        self.file_manager.read_journal(date).await.ok()
    } else if ct.id == "page" {
        self.file_manager.read_page(&meta.name).await.ok()
    } else {
        let bare_name = strip_directory_prefix(&meta.name, &ct.directory, ct.save_by_date);
        self.file_manager.read_sheet(ct, bare_name, meta.journal_date).await.ok()
    }
}
```

Add this as a method on `GardenState`. The branching is necessary here (journals use dates, pages use names, custom sheets need directory stripping), but it exists in exactly ONE place.

**Step 1:** Add the helper method to `GardenState`
**Step 2:** `cargo check`
**Step 3:** Commit

---

### Task 2: Unify rebuild_link_index

**Files:**
- Modify: `crates/tend-server/src/state.rs` (~lines 559-599)

Replace the current implementation (which already uses content_types param from our earlier fix) with the centralized helper:

```rust
pub async fn rebuild_link_index(&self, content_types: &[ContentType]) -> anyhow::Result<()> {
    let mut pages_iter: Vec<(String, Vec<tend_core::Block>)> = Vec::new();

    for ct in content_types {
        let sheets = self.file_manager.list_sheets(ct).await?;
        for meta in &sheets {
            if let Some(page) = self.load_sheet_from_meta(ct, meta).await {
                let blocks: Vec<_> = page.blocks.values().cloned().collect();
                pages_iter.push((page.name, blocks));
            }
        }
    }

    let mut link_index = self.link_index.write().await;
    link_index.rebuild_all(pages_iter.into_iter()).await?;
    Ok(())
}
```

**Step 1:** Replace implementation
**Step 2:** `cargo check`
**Step 3:** Commit

---

### Task 3: Unify rebuild_block_index

**Files:**
- Modify: `crates/tend-server/src/state.rs` (~lines 601-646)

Currently only indexes pages and journals. Change signature to take `content_types` and use the same pattern:

```rust
pub async fn rebuild_block_index(&self, content_types: &[ContentType]) -> anyhow::Result<()> {
    let Some(block_index) = &self.block_index else {
        return Err(anyhow::anyhow!("Block index not available"));
    };

    let mut all_pages: Vec<Page> = Vec::new();

    for ct in content_types {
        let sheets = self.file_manager.list_sheets(ct).await?;
        for meta in &sheets {
            if let Some(page) = self.load_sheet_from_meta(ct, meta).await {
                all_pages.push(page);
            }
        }
    }

    let mut index = block_index.lock().await;
    index.rebuild(all_pages.iter())?;
    Ok(())
}
```

Update callers in reindex.rs to pass content_types.

**Step 1:** Update signature and implementation
**Step 2:** Update callers
**Step 3:** `cargo check`
**Step 4:** Commit

---

### Task 4: Unify rebuild_tag_index

**Files:**
- Modify: `crates/tend-server/src/state.rs` (~lines 649-680)

Currently only indexes pages and journals. Same fix:

```rust
pub async fn rebuild_tag_index(&self, content_types: &[ContentType]) -> anyhow::Result<()> {
    let mut tag_index = self.tag_index.write().await;
    tag_index.clear();

    for ct in content_types {
        let sheets = self.file_manager.list_sheets(ct).await?;
        for meta in &sheets {
            if let Some(page) = self.load_sheet_from_meta(ct, meta).await {
                tag_index.index_page(&page);
            }
        }
    }

    Ok(())
}
```

Update callers in reindex.rs to pass content_types.

**Step 1:** Update signature and implementation
**Step 2:** Update callers
**Step 3:** `cargo check`
**Step 4:** Commit

---

### Task 5: Unify build_index and rebuild_search_index

**Files:**
- Modify: `crates/tend-server/src/state.rs` (~lines 455-542)

Both `build_index` and `rebuild_search_index` have separate page/journal loops. Unify to iterate all content types. These need content_types passed in or loaded internally.

**Step 1:** Update `build_index` to take content_types and iterate uniformly
**Step 2:** Update `rebuild_search_index` similarly
**Step 3:** Update callers
**Step 4:** `cargo check`
**Step 5:** Commit

---

### Task 6: Unify get_backlinks

**Files:**
- Modify: `crates/tend-server/src/routes/pages.rs` (~lines 245-350)

Replace the separate pages + journals loops with a single content-type iteration:

```rust
let content_types = load_user_content_types(&user.username).unwrap_or_default();

for ct in &content_types {
    let sheets = garden.file_manager.list_sheets(ct).await?;
    for sheet_meta in &sheets {
        let page_hash = hash_page_name(&sheet_meta.name);
        if !source_hashes.contains(&page_hash) {
            continue;
        }

        if let Some(page) = garden.load_sheet_from_meta(ct, &sheet_meta).await {
            let block_uuids = source_blocks.get(&page_hash);
            for block in page.blocks.values() {
                if let Some(uuids) = block_uuids {
                    let block_uuid_str = block.uuid.to_string();
                    if uuids.contains(&block_uuid_str) {
                        backlinks.push(BacklinkRef {
                            page_name: page.name.clone(),
                            page_title: page.title.clone(),
                            block_uuid: block_uuid_str,
                            block_content: block.content.clone(),
                            is_journal: page.is_journal,
                            journal_date: page.journal_date.map(|d| d.format("%Y-%m-%d").to_string()),
                        });
                    }
                }
            }
        }
    }
}
```

**Step 1:** Add import for load_user_content_types
**Step 2:** Replace separate loops with unified iteration
**Step 3:** `cargo check`
**Step 4:** Commit

---

### Task 7: Unify reindex.rs stabilize and reindex functions

**Files:**
- Modify: `crates/tend-server/src/routes/reindex.rs`

Update all rebuild calls to pass content_types (some already do from our earlier fix). Clean up the stabilize function's path construction and write routing to use the centralized helper where possible.

**Step 1:** Ensure all rebuild calls pass content_types
**Step 2:** Clean up stabilize branching
**Step 3:** `cargo check`
**Step 4:** Commit

---

### Task 8: Unify frontend save logic in pageStore.ts

**Files:**
- Modify: `packages/web/src/stores/pageStore.ts`

The `updateCurrentPage` function (lines 656-692) has three branches for journal/page/custom. Replace with a single path through the sheets API:

```typescript
// Always use sheets API
const contentTypeObj = useSettingsStore.getState().contentTypes.find(ct => ct.id === contentType)
if (contentTypeObj) {
    const sheetName = extractSheetName(contentTypeObj, pageName)
    const sheetDate = extractDateFromPageName(contentTypeObj, pageName)
    updatedPage = await api.sheets.update(contentType, sheetName, apiBlocks, version, sheetDate)
} else {
    // Fallback for unknown content type
    updatedPage = await api.sheets.update(contentType, pageName, apiBlocks, version)
}
```

This works because the sheets API already handles pages and journals as built-in content types.

Also fix conflict resolution (`resolveConflictKeepMine`, `resolveConflictKeepServer`) to use the same unified path.

**Step 1:** Unify updateCurrentPage save path
**Step 2:** Unify conflict resolution
**Step 3:** Remove extractSheetName/extractDateFromPageName if no longer needed (or keep if sheets API still requires them)
**Step 4:** `npx tsc --noEmit`
**Step 5:** Commit

---

### Task 9: Fix BacklinksPanel navigation

**Files:**
- Modify: `packages/web/src/components/panels/BacklinksPanel.tsx`

The click handler branches on `isJournal`. Instead, use `navigateToPage` for everything -- it already detects content type paths and routes appropriately:

```typescript
onClick={() => navigateToPage(pageNameKey)}
```

Journal navigation will still work because `navigateToPage` checks for journal-formatted names and routes to `navigateToJournal` internally. Verify this is true, or add the check if missing.

**Step 1:** Simplify click handler
**Step 2:** Verify journal navigation still works
**Step 3:** `npx tsc --noEmit`
**Step 4:** Commit

---

### Task 10: Remove debug logging from tend-links

**Files:**
- Modify: `crates/tend-links/src/lib.rs`

Remove the extra debug fields added during investigation (entries, target_index_keys, has_hash).

**Step 1:** Restore original debug line
**Step 2:** Commit

---

### Task 11: Final verification

**Step 1:** `cargo check` (backend)
**Step 2:** `cargo test` (all tests)
**Step 3:** `npx tsc --noEmit` (frontend)
**Step 4:** Test in dev environment:
  - Create a meeting with [[person/Name]] links
  - Visit person page -- backlinks should show meeting
  - Restart server -- backlinks should persist
  - Search for content in custom sheets -- should find results
  - Tags in custom sheets should appear in tag index
  - Block references in custom sheets should resolve

---

## NOT in scope (separate tasks)

- Removing the dedicated `/pages` and `/journals` API endpoints (breaking change, needs migration)
- Removing `isJournal` / `journalDate` from Page type (deep refactor)
- Todo index rebuild performance (noted in docs/plans/todo-reindex-perf.md)
