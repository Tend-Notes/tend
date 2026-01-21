// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Journal API routes

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use chrono::{Local, NaiveDate};
use tend_core::{Block, Page, PageMeta};
use tracing::debug;

use crate::error::AppError;
use crate::routes::pages::UpdatePageRequest;
use crate::state::AppState;

/// List all journals
pub async fn list_journals(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<PageMeta>>, AppError> {
    let garden = state.garden.read().await;
    let journals = garden.file_manager.list_journals().await?;
    Ok(Json(journals))
}

/// Get today's journal (creates if doesn't exist)
pub async fn get_today(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Page>, AppError> {
    let garden = state.garden.read().await;
    let today = Local::now().date_naive();
    let page = garden.file_manager.read_journal(today).await?;

    // If the page is empty (new journal), create it with an empty block
    if page.blocks.is_empty() {
        let mut new_page = Page::new_journal(today);
        let block = Block::new("");
        new_page.add_block(block);

        garden.file_manager.write_page(&new_page).await?;

        // Index the new journal (if search is enabled)
        if let Some(search_index) = &garden.search_index {
            let mut index = search_index.write().await;
            index.index_page(&new_page)?;
            index.commit()?;
        }

        debug!("Created today's journal: {}", today);
        return Ok(Json(new_page));
    }

    Ok(Json(page))
}

/// Get a journal by date
pub async fn get_journal(
    State(state): State<Arc<AppState>>,
    Path(date_str): Path<String>,
) -> Result<Json<Page>, AppError> {
    let garden = state.garden.read().await;
    let date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest(format!("Invalid date format: {}", date_str)))?;

    let page = garden.file_manager.read_journal(date).await?;
    Ok(Json(page))
}

/// Update a journal
pub async fn update_journal(
    State(state): State<Arc<AppState>>,
    Path(date_str): Path<String>,
    Json(req): Json<UpdatePageRequest>,
) -> Result<Json<Page>, AppError> {
    let garden = state.garden.read().await;
    let date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest(format!("Invalid date format: {}", date_str)))?;

    // Read existing journal or create new
    let mut page = garden
        .file_manager
        .read_journal(date)
        .await
        .unwrap_or_else(|_| Page::new_journal(date));

    // Version conflict check
    if let Some(expected_version) = req.version {
        if page.version != expected_version {
            return Err(AppError::Conflict {
                current_version: page.version,
                message: format!(
                    "Version mismatch: expected {}, current {}",
                    expected_version, page.version
                ),
            });
        }
    }

    // Clear existing blocks
    page.blocks.clear();
    page.root_blocks.clear();

    // Add blocks from request
    for block_data in req.blocks {
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
    garden.file_manager.write_page(&page).await?;

    // Update search index (if search is enabled)
    if let Some(search_index) = &garden.search_index {
        let mut index = search_index.write().await;
        index.index_page(&page)?;
        index.commit()?;
    }

    debug!("Updated journal: {} (version {})", date_str, page.version);
    Ok(Json(page))
}
