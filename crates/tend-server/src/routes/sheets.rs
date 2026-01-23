// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Sheet routes - generic content type API
//!
//! Sheets are the abstract content units that can be pages, journals, or custom types.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::NaiveDate;
use serde::Deserialize;
use tend_core::{Block, ContentType, Page, PageMeta};

use crate::error::AppError;
use crate::state::AppState;

use super::gardens::load_content_types;

/// Path parameters for sheet routes
#[derive(Debug, Deserialize)]
pub struct SheetPath {
    /// Content type ID (e.g., "page", "journal", "meetings")
    pub content_type: String,
    /// Sheet name
    pub name: String,
}

/// Query parameters for sheet operations
#[derive(Debug, Deserialize)]
pub struct SheetQuery {
    /// Optional date for save_by_date content types (format: YYYY-MM-DD)
    pub date: Option<String>,
}

/// Request to create a new sheet
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSheetRequest {
    pub name: String,
    /// Optional date for save_by_date content types
    pub date: Option<String>,
    /// Initial content (optional)
    pub content: Option<String>,
}

/// Request to update a sheet
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSheetRequest {
    pub name: String,
    pub title: String,
    pub root_blocks: Vec<String>,
    pub blocks: std::collections::HashMap<String, Block>,
    #[serde(default)]
    pub version: u64,
}

/// Look up a content type by ID from the active garden's config
fn get_content_type(content_type_id: &str) -> Result<ContentType, AppError> {
    let content_types = load_content_types()?;

    content_types
        .into_iter()
        .find(|ct| ct.id == content_type_id)
        .ok_or_else(|| AppError::NotFound(format!("Content type '{}' not found", content_type_id)))
}

/// Parse date from query string
fn parse_date(date_str: &Option<String>) -> Result<Option<NaiveDate>, AppError> {
    match date_str {
        Some(s) => NaiveDate::parse_from_str(s, "%Y-%m-%d")
            .map(Some)
            .map_err(|_| AppError::BadRequest(format!("Invalid date format: {}. Expected YYYY-MM-DD", s))),
        None => Ok(None),
    }
}

/// List all sheets of a content type
pub async fn list_sheets(
    State(state): State<Arc<AppState>>,
    Path(content_type_id): Path<String>,
) -> Result<Json<Vec<PageMeta>>, AppError> {
    let content_type = get_content_type(&content_type_id)?;
    let garden = state.garden.read().await;
    let sheets = garden.file_manager.list_sheets(&content_type).await?;
    Ok(Json(sheets))
}

/// Get a specific sheet
pub async fn get_sheet(
    State(state): State<Arc<AppState>>,
    Path(path): Path<SheetPath>,
    Query(query): Query<SheetQuery>,
) -> Result<Json<Page>, AppError> {
    let content_type = get_content_type(&path.content_type)?;
    let date = parse_date(&query.date)?;
    let garden = state.garden.read().await;
    let page = garden.file_manager.read_sheet(&content_type, &path.name, date).await?;
    Ok(Json(page))
}

/// Create a new sheet
pub async fn create_sheet(
    State(state): State<Arc<AppState>>,
    Path(content_type_id): Path<String>,
    Json(req): Json<CreateSheetRequest>,
) -> Result<Json<Page>, AppError> {
    let content_type = get_content_type(&content_type_id)?;
    let date = parse_date(&req.date)?;

    // For save_by_date types, use today if no date provided
    let date = if content_type.save_by_date && date.is_none() {
        Some(chrono::Local::now().date_naive())
    } else {
        date
    };

    let garden = state.garden.read().await;

    // Check if sheet already exists
    if garden.file_manager.sheet_exists(&content_type, &req.name, date).await {
        return Err(AppError::BadRequest(format!(
            "Sheet '{}' already exists in content type '{}'",
            req.name, content_type_id
        )));
    }

    // Create the page
    let mut page = Page::new(&req.name);

    // Apply template if available
    let initial_content = req.content
        .or_else(|| if !content_type.template.is_empty() { Some(content_type.template.clone()) } else { None });

    if let Some(content) = initial_content {
        let block = Block::new(content);
        page.add_block(block);
    }

    garden.file_manager.write_sheet(&content_type, &page, date).await?;

    // Index the new sheet (if search is enabled)
    if let Some(search_index) = &garden.search_index {
        let mut index = search_index.write().await;
        index.index_page(&page)?;
        index.commit()?;
    }

    Ok(Json(page))
}

/// Update a sheet
pub async fn update_sheet(
    State(state): State<Arc<AppState>>,
    Path(path): Path<SheetPath>,
    Query(query): Query<SheetQuery>,
    Json(req): Json<UpdateSheetRequest>,
) -> Result<Json<Page>, AppError> {
    let content_type = get_content_type(&path.content_type)?;
    let date = parse_date(&query.date)?;

    let garden = state.garden.read().await;

    // Read existing page for version check
    let existing = garden.file_manager.read_sheet(&content_type, &path.name, date).await?;

    // Version conflict check
    if req.version > 0 && existing.version != req.version {
        return Err(AppError::Conflict {
            current_version: existing.version,
            message: format!(
                "Version conflict: expected {}, got {}",
                existing.version, req.version
            ),
        });
    }

    // Build updated page
    let page = Page {
        name: req.name,
        title: req.title,
        root_blocks: req.root_blocks.iter().filter_map(|s| s.parse().ok()).collect(),
        blocks: req.blocks.into_iter().filter_map(|(k, v)| k.parse().ok().map(|uuid| (uuid, v))).collect(),
        properties: existing.properties,
        content_type: existing.content_type,
        is_journal: existing.is_journal,
        journal_date: existing.journal_date,
        created_at: existing.created_at,
        modified_at: chrono::Utc::now(),
        version: existing.version + 1,
    };

    garden.file_manager.write_sheet(&content_type, &page, date).await?;

    // Update search index (if search is enabled)
    if let Some(search_index) = &garden.search_index {
        let mut index = search_index.write().await;
        index.index_page(&page)?;
        index.commit()?;
    }

    Ok(Json(page))
}

/// Delete a sheet
pub async fn delete_sheet(
    State(state): State<Arc<AppState>>,
    Path(path): Path<SheetPath>,
    Query(query): Query<SheetQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let content_type = get_content_type(&path.content_type)?;
    let date = parse_date(&query.date)?;

    let garden = state.garden.read().await;
    garden.file_manager.delete_sheet(&content_type, &path.name, date).await?;

    // Remove from search index (if search is enabled)
    if let Some(search_index) = &garden.search_index {
        let mut index = search_index.write().await;
        index.remove_page(&path.name)?;
        index.commit()?;
    }

    Ok(Json(serde_json::json!({
        "deleted": path.name,
        "contentType": path.content_type
    })))
}
