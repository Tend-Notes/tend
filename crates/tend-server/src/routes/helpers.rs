// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Shared helper functions for route handlers
//!
//! This module provides common functionality used across multiple route handlers
//! to reduce code duplication.

use tend_core::{Block, Page};
use tracing::warn;

use crate::error::AppError;
use crate::state::GardenState;

use super::pages::BlockData;

/// Apply block updates to a page from a request.
///
/// This function:
/// 1. Checks for version conflicts if `expected_version` is provided
/// 2. Clears existing blocks from the page
/// 3. Parses and adds all blocks from the request data
/// 4. Increments the page version and updates the timestamp
///
/// # Arguments
/// * `page` - The page to update (mutably)
/// * `blocks` - Block data from the API request
/// * `expected_version` - Optional version for conflict detection
///
/// # Errors
/// Returns `AppError::Conflict` if version mismatch, or `AppError::BadRequest` for invalid UUIDs.
pub fn apply_block_updates(
    page: &mut Page,
    blocks: Vec<BlockData>,
    expected_version: Option<u64>,
) -> Result<(), AppError> {
    // Version conflict check
    if let Some(expected) = expected_version {
        if page.version != expected {
            return Err(AppError::Conflict {
                current_version: page.version,
                message: format!(
                    "Version mismatch: expected {}, current {}",
                    expected, page.version
                ),
            });
        }
    }

    // Clear existing blocks
    page.blocks.clear();
    page.root_blocks.clear();

    // Add blocks from request
    for block_data in blocks {
        let uuid = block_data
            .uuid
            .parse()
            .map_err(|_| AppError::BadRequest("Invalid UUID".to_string()))?;

        let mut block = Block::with_uuid(uuid, &block_data.content);

        block.parent_uuid = block_data
            .parent_uuid
            .as_ref()
            .and_then(|s| s.parse().ok());

        block.children = block_data
            .children
            .iter()
            .filter_map(|s| s.parse().ok())
            .collect();

        block.collapsed = block_data.collapsed;
        block.properties = block_data.properties;

        page.add_block(block);
    }

    // Increment version and update timestamp
    page.version += 1;
    page.touch();

    Ok(())
}

/// Update all indices (search, link, block) for a page.
///
/// This function updates:
/// 1. Search index (Tantivy) - if enabled
/// 2. Link index - for backlink tracking
/// 3. Block index - if available (not for encrypted gardens)
///
/// Failures are logged as warnings but do not cause the operation to fail,
/// since the primary write has already succeeded.
///
/// # Arguments
/// * `garden` - The garden state containing the indices
/// * `page` - The page that was updated
/// * `entity_type` - Human-readable name for log messages (e.g., "page", "journal", "sheet")
pub async fn update_all_indices(garden: &GardenState, page: &Page, entity_type: &str) {
    // Update search index (if search is enabled)
    if let Some(search_index) = &garden.search_index {
        let mut index = search_index.write().await;
        if let Err(e) = index.index_page(page) {
            warn!("Failed to update search index for {} {}: {}", entity_type, page.name, e);
        } else if let Err(e) = index.commit() {
            warn!("Failed to commit search index for {} {}: {}", entity_type, page.name, e);
        }
    }

    // Update link index
    {
        let blocks: Vec<_> = page.blocks.values().cloned().collect();
        let mut link_index = garden.link_index.write().await;
        if let Err(e) = link_index.index_page(&page.name, &blocks).await {
            warn!("Failed to update link index for {} {}: {}", entity_type, page.name, e);
        }
    }

    // Update block index (if available - not for encrypted gardens)
    if let Some(block_index) = &garden.block_index {
        let mut index = block_index.lock().await;
        if let Err(e) = index.update_page(page) {
            warn!("Failed to update block index for {} {}: {}", entity_type, page.name, e);
        }
    }
}
