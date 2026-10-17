// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Reindex API route
//!
//! Provides endpoints that rebuild indices from disk, and a stabilize endpoint
//! that adds Tend footers (stable block UUIDs) to files that lack them.

use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use serde::Serialize;
use tracing::info;

use tend_core::block_metadata::FOOTER_START;
use tend_core::parser::parse_markdown;

use crate::auth::AuthenticatedUser;
use crate::error::AppError;
use crate::routes::gardens::load_user_content_types;
use crate::state::AppState;

/// Response for the reindex operation
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReindexResponse {
    /// Total number of sheets processed (all content types)
    pub sheets_indexed: usize,
    /// Number of link index entries after rebuild
    pub link_entries: usize,
    /// Number of blocks in the block index after rebuild (if available)
    pub block_count: Option<usize>,
    /// Number of search documents after rebuild (if search enabled)
    pub search_docs: Option<u64>,
    /// Number of unique tags after rebuild
    pub tag_count: usize,
    /// Number of tasks after rebuild
    pub task_count: usize,
    /// Human-readable summary message
    pub message: String,
}

/// Rebuild every index from disk, in dependency order, collecting failures
/// rather than stopping at the first one.
///
/// Returns `(step, error)` pairs for whatever failed; an empty vec means all
/// five rebuilt. The block index is the exception that is never reported: it
/// does not exist for encrypted gardens, so "skipped" is normal and both
/// callers only ever logged it.
async fn rebuild_all_indices(
    garden: &crate::state::GardenState,
    content_types: &[tend_core::ContentType],
) -> Vec<(&'static str, anyhow::Error)> {
    let mut failures = Vec::new();

    if let Err(e) = garden.rebuild_link_index(content_types).await {
        failures.push(("link", e));
    }

    if garden.search_config.enabled {
        if let Err(e) = garden.rebuild_search_index(content_types).await {
            failures.push(("search", e));
        }
    }

    if let Err(e) = garden.rebuild_block_index(content_types).await {
        tracing::warn!("Block index rebuild skipped: {}", e);
    }

    if let Err(e) = garden.rebuild_tag_index(content_types).await {
        failures.push(("tag", e));
    }

    if let Err(e) = garden.rebuild_todo_index(content_types).await {
        failures.push(("todo", e));
    }

    failures
}

/// Rebuild all indices from disk
///
/// This endpoint reads ALL pages and journals from disk and rebuilds:
/// 1. The link index (wikilinks, tags, backlinks)
/// 2. The search index (full-text search)
/// 3. The block reference index (block UUID lookups)
/// 4. The tag index (tag aggregation)
/// 5. The todo index (task aggregation)
///
/// Returns counts of what was indexed.
pub async fn reindex(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<Json<ReindexResponse>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;

    let content_types = load_user_content_types(&user.username).unwrap_or_default();

    // Count all sheets across content types
    let sheets_count = {
        let garden = user_state.garden.read().await;
        let mut count = 0usize;
        for ct in &content_types {
            count += garden.file_manager.list_sheets(ct).await?.len();
        }
        count
    };

    info!(
        "Reindexing all indices for user {} ({} sheets)",
        user.username, sheets_count
    );

    // Rebuild every index, then read the counts back out.
    {
        let garden = user_state.garden.read().await;
        if let Some((step, err)) = rebuild_all_indices(&garden, &content_types).await.into_iter().next() {
            return Err(AppError::Internal(format!(
                "Failed to rebuild {} index: {}",
                step, err
            )));
        }
    }

    let search_doc_count = {
        let garden = user_state.garden.read().await;
        if garden.search_config.enabled {
            garden.search_index.clone()
        } else {
            None
        }
    };
    let search_doc_count = if let Some(idx) = search_doc_count {
        Some(idx.read().await.num_docs())
    } else {
        None
    };

    let block_count = {
        let garden = user_state.garden.read().await;
        if let Some(block_index) = &garden.block_index {
            Some(block_index.lock().await.len().unwrap_or(0))
        } else {
            None
        }
    };

    // Get final counts
    let (link_entries, tag_count, task_count) = {
        let garden = user_state.garden.read().await;
        let link_index = garden.link_index.read().await;
        let tag_index = garden.tag_index.read().await;
        let todo_index = garden.todo_index.read().await;
        (link_index.len(), tag_index.len(), todo_index.len())
    };

    let message = format!(
        "Rebuilt all indices for {} sheets",
        sheets_count
    );

    info!("{}", message);

    Ok(Json(ReindexResponse {
        sheets_indexed: sheets_count,
        link_entries,
        block_count,
        search_docs: search_doc_count,
        tag_count,
        task_count,
        message,
    }))
}

/// Response for the stabilize operation
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StabilizeResponse {
    /// Number of files that were stabilized (had footer added)
    pub stabilized: usize,
    /// Number of files already stable (had footer)
    pub already_stable: usize,
    /// Number of files that failed to stabilize
    pub failed: usize,
    /// Human-readable summary message
    pub message: String,
}

/// Stabilize block UUIDs across all pages, journals, and sheets
///
/// Reads all files from disk. For any file that lacks a Tend footer
/// (i.e., has no stable block UUIDs), re-saves it through write_page/write_sheet
/// to add the footer. Then triggers a full reindex.
///
/// This fixes pages imported before the footer was added to the import path.
pub async fn stabilize(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<Json<StabilizeResponse>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let content_types = load_user_content_types(&user.username).unwrap_or_default();

    let mut stabilized = 0usize;
    let mut already_stable = 0usize;
    let mut failed = 0usize;

    // Phase 1: Add footers to files that lack them
    for ct in &content_types {
        let garden = user_state.garden.read().await;
        let sheets = match garden.file_manager.list_sheets(ct).await {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!("Failed to list sheets for {}: {}", ct.id, e);
                continue;
            }
        };

        for sheet_meta in &sheets {
            // Split the canonical name back into the bare name + date the file
            // manager expects, then let it find and read the file: it owns
            // filename encoding, the legacy un-encoded fallback, and decryption.
            // Hand-building the path here missed all three, so encoded-name
            // sheets were counted failed and every sheet in an encrypted garden
            // read back as ciphertext.
            let (bare_name, split_date) = tend_core::split_name(ct, &sheet_meta.name);
            let sheet_date = sheet_meta.journal_date.or(split_date);

            let raw = match garden
                .file_manager
                .read_sheet_raw(ct, bare_name, sheet_date)
                .await
            {
                Ok(content) => content,
                Err(e) => {
                    tracing::warn!("Failed to read {}/{} for stabilization: {}", ct.id, sheet_meta.name, e);
                    failed += 1;
                    continue;
                }
            };

            // Check if the file already has a footer
            if raw.contains(FOOTER_START) {
                already_stable += 1;
                continue;
            }

            // File lacks a footer -- parse and re-save through the file manager
            let page_name = &sheet_meta.name;
            match parse_markdown(&raw, page_name) {
                Ok(mut page) => {
                    // Set journal-specific fields
                    if ct.id == "journal" {
                        page.is_journal = true;
                        page.journal_date = sheet_meta.journal_date;
                    }
                    page.content_type = ct.id.clone();

                    let write_result = if ct.id == "page" || ct.id == "journal" {
                        garden.file_manager.write_page(&page).await
                    } else {
                        garden.file_manager.write_sheet(ct, &page, sheet_meta.journal_date).await
                    };

                    match write_result {
                        Ok(_) => {
                            stabilized += 1;
                            info!("Stabilized UUIDs for {}/{}", ct.id, page_name);
                        }
                        Err(e) => {
                            tracing::warn!("Failed to stabilize {}/{}: {}", ct.id, page_name, e);
                            failed += 1;
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!("Failed to parse {}/{} for stabilization: {}", ct.id, page_name, e);
                    failed += 1;
                }
            }
        }
    }

    info!(
        "Stabilization complete: {} stabilized, {} already stable, {} failed",
        stabilized, already_stable, failed
    );

    // Phase 2: If we stabilized any files, rebuild all indices so they
    // pick up the new stable UUIDs
    if stabilized > 0 {
        info!("Rebuilding indices after stabilization...");

        let garden = user_state.garden.read().await;
        for (step, err) in rebuild_all_indices(&garden, &content_types).await {
            tracing::warn!("Failed to rebuild {} index after stabilize: {}", step, err);
        }
    }

    let message = format!(
        "Stabilized {} files ({} already stable, {} failed)",
        stabilized, already_stable, failed
    );

    Ok(Json(StabilizeResponse {
        stabilized,
        already_stable,
        failed,
        message,
    }))
}
