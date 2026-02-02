// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Sheet routes - generic content type API
//!
//! Sheets are the abstract content units that can be pages, journals, or custom types.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use tend_core::{Block, ContentType, Page, PageMeta};
use uuid::Uuid;

use crate::auth::AuthenticatedUser;
use crate::error::AppError;
use crate::routes::pages::BlockData;
use crate::state::AppState;

use super::gardens::load_user_content_types;

/// Marker for cursor position in templates
const CURSOR_MARKER: &str = "{{cursor}}";

/// Build the full page name for a sheet including the directory path.
/// This is used for block index storage and navigation.
///
/// Formats:
/// - Non-date: `directory/name` (e.g., "person/John Smith")
/// - SaveByDate: `directory/YYYY-MM-DD/name` (e.g., "meeting/2026-01-30/Standup")
fn build_sheet_page_name(content_type: &ContentType, name: &str, date: Option<NaiveDate>) -> String {
    if content_type.save_by_date {
        if let Some(d) = date {
            format!("{}/{}/{}", content_type.directory, d.format("%Y-%m-%d"), name)
        } else {
            // Default to today if no date provided
            let today = chrono::Local::now().date_naive();
            format!("{}/{}/{}", content_type.directory, today.format("%Y-%m-%d"), name)
        }
    } else {
        format!("{}/{}", content_type.directory, name)
    }
}

/// Cursor position information for template instantiation
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorPosition {
    /// UUID of the block containing the cursor marker
    pub block_uuid: String,
    /// Character offset within the block content
    pub offset: usize,
}

/// Response for sheet creation, including optional cursor position
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSheetResponse {
    /// The created page
    #[serde(flatten)]
    pub page: Page,
    /// Cursor position if template contained {{cursor}} marker
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor_position: Option<CursorPosition>,
}

/// Helper function to copy a block tree from a template page to a new page.
/// Creates new UUIDs for all blocks while preserving the tree structure.
/// If a {{cursor}} marker is found, it's removed and the position is tracked.
///
/// Returns the cursor position if found (only the first occurrence is tracked).
fn copy_block_tree(
    template: &Page,
    template_uuid: Uuid,
    new_parent_uuid: Option<Uuid>,
    target: &mut Page,
    cursor_position: &mut Option<CursorPosition>,
) {
    if let Some(template_block) = template.blocks.get(&template_uuid) {
        // Create a new block with a new UUID
        let new_uuid = Uuid::new_v4();

        // Process content: look for {{cursor}} marker and remove it
        let (content, found_cursor_offset) = process_cursor_marker(&template_block.content, cursor_position.is_none());

        // Track cursor position if found (only first occurrence)
        if let Some(offset) = found_cursor_offset {
            if cursor_position.is_none() {
                *cursor_position = Some(CursorPosition {
                    block_uuid: new_uuid.to_string(),
                    offset,
                });
            }
        }

        let mut new_block = Block::with_uuid(new_uuid, &content);
        new_block.collapsed = template_block.collapsed;
        new_block.properties = template_block.properties.clone();
        new_block.parent_uuid = new_parent_uuid;

        // Recursively copy children and collect their new UUIDs
        let mut new_children = Vec::new();
        for child_uuid in &template_block.children {
            if template.blocks.contains_key(child_uuid) {
                let child_new_uuid = copy_block_tree_inner(template, *child_uuid, Some(new_uuid), target, cursor_position);
                new_children.push(child_new_uuid);
            }
        }
        new_block.children = new_children;

        target.add_block(new_block);
    }
}

/// Inner recursive helper that returns the new UUID of the copied block
fn copy_block_tree_inner(
    template: &Page,
    template_uuid: Uuid,
    new_parent_uuid: Option<Uuid>,
    target: &mut Page,
    cursor_position: &mut Option<CursorPosition>,
) -> Uuid {
    let template_block = template.blocks.get(&template_uuid).unwrap();

    // Create a new block with a new UUID
    let new_uuid = Uuid::new_v4();

    // Process content: look for {{cursor}} marker and remove it
    let (content, found_cursor_offset) = process_cursor_marker(&template_block.content, cursor_position.is_none());

    // Track cursor position if found (only first occurrence)
    if let Some(offset) = found_cursor_offset {
        if cursor_position.is_none() {
            *cursor_position = Some(CursorPosition {
                block_uuid: new_uuid.to_string(),
                offset,
            });
        }
    }

    let mut new_block = Block::with_uuid(new_uuid, &content);
    new_block.collapsed = template_block.collapsed;
    new_block.properties = template_block.properties.clone();
    new_block.parent_uuid = new_parent_uuid;

    // Recursively copy children
    let mut new_children = Vec::new();
    for child_uuid in &template_block.children {
        let child_new_uuid = copy_block_tree_inner(template, *child_uuid, Some(new_uuid), target, cursor_position);
        new_children.push(child_new_uuid);
    }
    new_block.children = new_children;

    target.add_block(new_block);
    new_uuid
}

/// Process content to find and remove the {{cursor}} marker.
/// Returns (processed_content, Some(offset)) if marker was found and should_track is true.
/// Returns (original_content, None) if marker not found or should_track is false.
fn process_cursor_marker(content: &str, should_track: bool) -> (String, Option<usize>) {
    if !should_track {
        // Even if we're not tracking, we should still remove any cursor markers
        let cleaned = content.replace(CURSOR_MARKER, "");
        return (cleaned, None);
    }

    if let Some(offset) = content.find(CURSOR_MARKER) {
        // Found the marker - remove it and return the offset
        let cleaned = content.replace(CURSOR_MARKER, "");
        (cleaned, Some(offset))
    } else {
        (content.to_string(), None)
    }
}

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

/// Request to update a sheet (same format as page updates)
#[derive(Debug, Deserialize)]
pub struct UpdateSheetRequest {
    pub blocks: Vec<BlockData>,
    /// Expected version for conflict detection
    pub version: Option<u64>,
}

/// Look up a content type by ID from the active garden's config for a user
fn get_content_type(content_type_id: &str, username: &str) -> Result<ContentType, AppError> {
    let content_types = load_user_content_types(username)?;

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
    user: AuthenticatedUser,
    Path(content_type_id): Path<String>,
) -> Result<Json<Vec<PageMeta>>, AppError> {
    let content_type = get_content_type(&content_type_id, &user.username)?;
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;
    let sheets = garden.file_manager.list_sheets(&content_type).await?;
    Ok(Json(sheets))
}

/// Get a specific sheet
pub async fn get_sheet(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Path(path): Path<SheetPath>,
    Query(query): Query<SheetQuery>,
) -> Result<Json<Page>, AppError> {
    let content_type = get_content_type(&path.content_type, &user.username)?;
    let date = parse_date(&query.date)?;
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;
    let page = garden.file_manager.read_sheet(&content_type, &path.name, date).await?;
    Ok(Json(page))
}

/// Create a new sheet
pub async fn create_sheet(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Path(content_type_id): Path<String>,
    Json(req): Json<CreateSheetRequest>,
) -> Result<Json<CreateSheetResponse>, AppError> {
    let content_type = get_content_type(&content_type_id, &user.username)?;
    let date = parse_date(&req.date)?;

    // For save_by_date types, use today if no date provided
    let date = if content_type.save_by_date && date.is_none() {
        Some(chrono::Local::now().date_naive())
    } else {
        date
    };

    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;

    // Check if sheet already exists
    if garden.file_manager.sheet_exists(&content_type, &req.name, date).await {
        return Err(AppError::BadRequest(format!(
            "Sheet '{}' already exists in content type '{}'",
            req.name, content_type_id
        )));
    }

    // Create the page with correct content type
    // Use the full path as the page name for block index storage
    let full_page_name = build_sheet_page_name(&content_type, &req.name, date);
    let mut page = Page::new_sheet(&full_page_name, &content_type_id, date);
    // Keep the title as just the name (without directory) for display
    page.title = req.name.clone();

    // Track cursor position from template {{cursor}} marker
    let mut cursor_position: Option<CursorPosition> = None;

    // Apply template if available
    // Priority: 1) Request content, 2) Template file, 3) Config template string
    if let Some(content) = &req.content {
        // User provided explicit content - check for cursor marker
        let (processed_content, found_offset) = process_cursor_marker(content, true);
        if let Some(offset) = found_offset {
            let block = Block::new(processed_content);
            cursor_position = Some(CursorPosition {
                block_uuid: block.uuid.to_string(),
                offset,
            });
            page.add_block(block);
        } else {
            let block = Block::new(content.clone());
            page.add_block(block);
        }
    } else {
        // Try to load template file first
        let template_path = garden
            .file_manager
            .root()
            .join(".tend")
            .join("templates")
            .join(format!("{}.md", content_type_id));

        if template_path.exists() {
            // Use template file - copy its blocks with new UUIDs
            if let Ok(template_content) = tokio::fs::read_to_string(&template_path).await {
                if let Ok(template_page) = tend_core::parser::parse_markdown(&template_content, &content_type_id) {
                    // Copy blocks from template with new UUIDs, tracking cursor position
                    for root_uuid in &template_page.root_blocks {
                        copy_block_tree(&template_page, *root_uuid, None, &mut page, &mut cursor_position);
                    }
                }
            }
        } else if !content_type.template.is_empty() {
            // Fall back to config.template string for backwards compat
            // Also check for cursor marker here
            let (processed_content, found_offset) = process_cursor_marker(&content_type.template, true);
            let block = Block::new(processed_content);
            if let Some(offset) = found_offset {
                cursor_position = Some(CursorPosition {
                    block_uuid: block.uuid.to_string(),
                    offset,
                });
            }
            page.add_block(block);
        }
    }

    garden.file_manager.write_sheet(&content_type, &page, date).await?;

    // Index the new sheet (if search is enabled)
    if let Some(search_index) = &garden.search_index {
        let mut index = search_index.write().await;
        index.index_page(&page)?;
        index.commit()?;
    }

    // Update block index (if available - not for encrypted gardens)
    if let Some(block_index) = &garden.block_index {
        let mut index = block_index.lock().await;
        if let Err(e) = index.update_page(&page) {
            tracing::warn!("Failed to update block index for sheet {}: {}", page.name, e);
        }
    }

    Ok(Json(CreateSheetResponse {
        page,
        cursor_position,
    }))
}

/// Update a sheet
pub async fn update_sheet(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Path(path): Path<SheetPath>,
    Query(query): Query<SheetQuery>,
    Json(req): Json<UpdateSheetRequest>,
) -> Result<Json<Page>, AppError> {
    let content_type = get_content_type(&path.content_type, &user.username)?;
    let date = parse_date(&query.date)?;

    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;

    // Build full page name for block index storage
    let full_page_name = build_sheet_page_name(&content_type, &path.name, date);

    // Read existing sheet or create new
    let mut page = garden
        .file_manager
        .read_sheet(&content_type, &path.name, date)
        .await
        .unwrap_or_else(|_| {
            let mut p = Page::new_sheet(&full_page_name, &content_type.id, date);
            p.title = path.name.clone();
            p
        });

    // Ensure page.name uses the full path format for block index
    if !page.name.contains('/') {
        page.name = full_page_name;
    }

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

    // Add blocks from request (same as update_page)
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
    garden.file_manager.write_sheet(&content_type, &page, date).await?;

    // Update search index (if search is enabled)
    if let Some(search_index) = &garden.search_index {
        let mut index = search_index.write().await;
        index.index_page(&page)?;
        index.commit()?;
    }

    // Update block index (if available - not for encrypted gardens)
    if let Some(block_index) = &garden.block_index {
        let mut index = block_index.lock().await;
        if let Err(e) = index.update_page(&page) {
            tracing::warn!("Failed to update block index for sheet {}: {}", page.name, e);
        }
    }

    Ok(Json(page))
}

/// Delete a sheet
pub async fn delete_sheet(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Path(path): Path<SheetPath>,
    Query(query): Query<SheetQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let content_type = get_content_type(&path.content_type, &user.username)?;
    let date = parse_date(&query.date)?;

    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;
    garden.file_manager.delete_sheet(&content_type, &path.name, date).await?;

    // Remove from search index (if search is enabled)
    if let Some(search_index) = &garden.search_index {
        let mut index = search_index.write().await;
        index.remove_page(&path.name)?;
        index.commit()?;
    }

    // Remove from block index (if available - not for encrypted gardens)
    if let Some(block_index) = &garden.block_index {
        let mut index = block_index.lock().await;
        if let Err(e) = index.delete_page(&path.name) {
            tracing::warn!("Failed to remove sheet {} from block index: {}", path.name, e);
        }
    }

    Ok(Json(serde_json::json!({
        "deleted": path.name,
        "contentType": path.content_type
    })))
}
