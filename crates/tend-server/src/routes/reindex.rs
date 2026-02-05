// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Reindex API route
//!
//! Provides a single endpoint that rebuilds ALL indices (search, links, blocks)
//! from disk. This is useful after importing pages that may have stale or missing
//! index entries.

use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use serde::Serialize;
use tracing::info;

use crate::auth::AuthenticatedUser;
use crate::error::AppError;
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
    /// Human-readable summary message
    pub message: String,
}

/// Rebuild all indices from disk
///
/// This endpoint reads ALL pages and journals from disk and rebuilds:
/// 1. The link index (wikilinks, tags, backlinks)
/// 2. The search index (full-text search)
/// 3. The block reference index (block UUID lookups)
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

    // 2. Rebuild search index (requires write lock for build_index)
    let search_docs = {
        let mut garden = user_state.garden.write().await;
        if garden.search_config.enabled {
            garden
                .build_index()
                .await
                .map_err(|e| AppError::Internal(format!("Failed to rebuild search index: {}", e)))?;

            garden
                .search_index
                .as_ref()
                .map(|idx| {
                    // We can't await inside map, so we'll get it after
                    idx.clone()
                })
        } else {
            None
        }
    };

    // Get the doc count outside the write lock
    let search_doc_count = if let Some(idx) = search_docs {
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

    // Get final link count
    let link_entries = {
        let garden = user_state.garden.read().await;
        let link_index = garden.link_index.read().await;
        link_index.len()
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
        message,
    }))
}
