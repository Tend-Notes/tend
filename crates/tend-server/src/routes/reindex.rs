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
    /// Number of pages processed
    pub pages_indexed: usize,
    /// Number of journals processed
    pub journals_indexed: usize,
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

    // Count pages and journals for the response
    let (pages_count, journals_count) = {
        let garden = user_state.garden.read().await;
        let pages = garden.file_manager.list_pages().await?;
        let journals = garden.file_manager.list_journals().await?;
        (pages.len(), journals.len())
    };

    info!(
        "Reindexing all indices for user {} ({} pages, {} journals)",
        user.username, pages_count, journals_count
    );

    // 1. Rebuild link index (requires read lock)
    {
        let garden = user_state.garden.read().await;
        garden
            .rebuild_link_index()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to rebuild link index: {}", e)))?;
    }

    // 2. Rebuild search index in place (uses existing writer to avoid lock conflict)
    let search_doc_count = {
        let garden = user_state.garden.read().await;
        if garden.search_config.enabled {
            garden
                .rebuild_search_index()
                .await
                .map_err(|e| AppError::Internal(format!("Failed to rebuild search index: {}", e)))?;

            garden
                .search_index
                .as_ref()
                .map(|idx| idx.clone())
        } else {
            None
        }
    };

    // Get the doc count outside the read lock
    let search_doc_count = if let Some(idx) = search_doc_count {
        Some(idx.read().await.num_docs())
    } else {
        None
    };

    // 3. Rebuild block index (requires read lock)
    let block_count = {
        let garden = user_state.garden.read().await;
        match garden.rebuild_block_index().await {
            Ok(()) => {
                if let Some(block_index) = &garden.block_index {
                    Some(block_index.lock().await.len().unwrap_or(0))
                } else {
                    None
                }
            }
            Err(e) => {
                // Block index might not be available (encrypted garden) - that's ok
                tracing::warn!("Block index rebuild skipped: {}", e);
                None
            }
        }
    };

    // 4. Rebuild tag index (requires read lock)
    {
        let garden = user_state.garden.read().await;
        garden
            .rebuild_tag_index()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to rebuild tag index: {}", e)))?;
    }

    // 5. Rebuild todo index (requires read lock and content types)
    let content_types = load_user_content_types(&user.username).unwrap_or_default();
    {
        let garden = user_state.garden.read().await;
        garden
            .rebuild_todo_index(&content_types)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to rebuild todo index: {}", e)))?;
    }

    // Get final counts
    let (link_entries, tag_count, task_count) = {
        let garden = user_state.garden.read().await;
        let link_index = garden.link_index.read().await;
        let tag_index = garden.tag_index.read().await;
        let todo_index = garden.todo_index.read().await;
        (link_index.len(), tag_index.len(), todo_index.len())
    };

    let total = pages_count + journals_count;
    let message = format!(
        "Rebuilt all indices for {} pages and {} journals ({} total)",
        pages_count, journals_count, total
    );

    info!("{}", message);

    Ok(Json(ReindexResponse {
        pages_indexed: pages_count,
        journals_indexed: journals_count,
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

        let root = garden.file_manager.root().to_path_buf();

        for sheet_meta in &sheets {
            // Build the file path from root + directory structure
            let file_path = if ct.id == "journal" {
                if let Some(date) = sheet_meta.journal_date {
                    root.join("journals").join(format!("{}.md", date.format("%Y-%m-%d")))
                } else {
                    failed += 1;
                    continue;
                }
            } else if ct.id == "page" {
                root.join("pages").join(format!("{}.md", sheet_meta.name))
            } else if ct.save_by_date {
                if let Some(date) = sheet_meta.journal_date {
                    // Extract the sheet name from the full path (directory/date/name)
                    let name_part = sheet_meta.name
                        .rsplit('/')
                        .next()
                        .unwrap_or(&sheet_meta.name);
                    root.join(&ct.directory)
                        .join(date.format("%Y-%m-%d").to_string())
                        .join(format!("{}.md", name_part))
                } else {
                    root.join(&ct.directory).join(format!("{}.md", sheet_meta.name))
                }
            } else {
                // Strip directory prefix from name if present
                let name_part = if sheet_meta.name.starts_with(&ct.directory) {
                    &sheet_meta.name[ct.directory.len() + 1..]
                } else {
                    &sheet_meta.name
                };
                root.join(&ct.directory).join(format!("{}.md", name_part))
            };

            // Read the raw file content to check for footer
            let raw = match tokio::fs::read_to_string(&file_path).await {
                Ok(content) => content,
                Err(_) => {
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

        // Rebuild link index
        {
            let garden = user_state.garden.read().await;
            if let Err(e) = garden.rebuild_link_index().await {
                tracing::warn!("Failed to rebuild link index after stabilize: {}", e);
            }
        }

        // Rebuild search index in place (uses existing writer to avoid lock conflict)
        {
            let garden = user_state.garden.read().await;
            if garden.search_config.enabled {
                if let Err(e) = garden.rebuild_search_index().await {
                    tracing::warn!("Failed to rebuild search index after stabilize: {}", e);
                }
            }
        }

        // Rebuild block index
        {
            let garden = user_state.garden.read().await;
            if let Err(e) = garden.rebuild_block_index().await {
                tracing::warn!("Block index rebuild after stabilize skipped: {}", e);
            }
        }

        // Rebuild tag index
        {
            let garden = user_state.garden.read().await;
            if let Err(e) = garden.rebuild_tag_index().await {
                tracing::warn!("Failed to rebuild tag index after stabilize: {}", e);
            }
        }

        // Rebuild todo index
        {
            let garden = user_state.garden.read().await;
            if let Err(e) = garden.rebuild_todo_index(&content_types).await {
                tracing::warn!("Failed to rebuild todo index after stabilize: {}", e);
            }
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
