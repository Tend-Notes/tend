// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Page API routes

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use tend_core::{Block, Page, PageMeta};
use tracing::debug;

use crate::error::AppError;
use crate::state::AppState;

/// List all pages
pub async fn list_pages(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<PageMeta>>, AppError> {
    let garden = state.garden.read().await;
    let pages = garden.file_manager.list_pages().await?;
    Ok(Json(pages))
}

/// Request body for creating a page
#[derive(Debug, Deserialize)]
pub struct CreatePageRequest {
    pub name: String,
    pub content: Option<String>,
}

/// Create a new page
pub async fn create_page(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreatePageRequest>,
) -> Result<Json<Page>, AppError> {
    let garden = state.garden.read().await;

    // Check if page already exists
    if garden.file_manager.page_exists(&req.name).await {
        return Err(AppError::BadRequest(format!(
            "Page '{}' already exists",
            req.name
        )));
    }

    let mut page = Page::new(&req.name);

    // Add initial content if provided, otherwise create an empty block
    // (matching journal behavior for consistency)
    let block = Block::new(req.content.unwrap_or_default());
    page.add_block(block);

    garden.file_manager.write_page(&page).await?;

    // Index the new page
    {
        let mut index = garden.search_index.write().await;
        index.index_page(&page)?;
        index.commit()?;
    }

    debug!("Created page: {}", req.name);
    Ok(Json(page))
}

/// Get a page by name
pub async fn get_page(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> Result<Json<Page>, AppError> {
    let garden = state.garden.read().await;
    let page = garden.file_manager.read_page(&name).await?;
    Ok(Json(page))
}

/// Request body for updating a page
#[derive(Debug, Deserialize)]
pub struct UpdatePageRequest {
    pub blocks: Vec<BlockData>,
    /// Expected version for conflict detection. If provided and doesn't match
    /// the current version, returns 409 Conflict.
    pub version: Option<u64>,
}

/// Block data in API requests
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockData {
    pub uuid: String,
    pub content: String,
    pub parent_uuid: Option<String>,
    pub children: Vec<String>,
    pub collapsed: bool,
    #[serde(default)]
    pub properties: std::collections::HashMap<String, String>,
}

/// Update a page
pub async fn update_page(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Json(req): Json<UpdatePageRequest>,
) -> Result<Json<Page>, AppError> {
    let garden = state.garden.read().await;

    // Read existing page or create new
    let mut page = garden
        .file_manager
        .read_page(&name)
        .await
        .unwrap_or_else(|_| Page::new(&name));

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

    // Update search index
    {
        let mut index = garden.search_index.write().await;
        index.index_page(&page)?;
        index.commit()?;
    }

    debug!("Updated page: {} (version {})", name, page.version);
    Ok(Json(page))
}

/// Delete a page
pub async fn delete_page(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let garden = state.garden.read().await;
    garden.file_manager.delete_page(&name).await?;

    // Remove from search index
    {
        let mut index = garden.search_index.write().await;
        index.remove_page(&name)?;
        index.commit()?;
    }

    debug!("Deleted page: {}", name);
    Ok(Json(serde_json::json!({ "deleted": name })))
}

/// Backlink reference
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacklinkRef {
    pub page_name: String,
    pub page_title: String,
    pub block_uuid: String,
    pub block_content: String,
    pub is_journal: bool,
    pub journal_date: Option<String>,
}

/// Check if a block contains a reference to the given page name
fn block_contains_reference(content: &str, page_name: &str, tag_name: Option<&str>) -> bool {
    // Check for wiki-link reference [[page_name]]
    let wiki_link = format!("[[{}]]", page_name);
    if content.contains(&wiki_link) {
        return true;
    }

    // If this is a tag page (tags/tagname), also check for #tagname references
    if let Some(tag) = tag_name {
        // Use regex to match #tagname with word boundaries
        // Match at start of string or after whitespace, followed by # and the tag name
        let tag_pattern = format!(r"(?:^|\s)#{}(?:\s|$|[^\w-])", regex::escape(tag));
        if let Ok(re) = regex::Regex::new(&tag_pattern) {
            if re.is_match(content) {
                return true;
            }
        }
    }

    false
}

/// Get backlinks to a page
pub async fn get_backlinks(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> Result<Json<Vec<BacklinkRef>>, AppError> {
    let garden = state.garden.read().await;
    let mut backlinks = Vec::new();

    // Check if this is a tag page (tags/tagname)
    let tag_name = if name.starts_with("tags/") {
        Some(name.strip_prefix("tags/").unwrap())
    } else {
        None
    };

    // Scan all pages for links
    // TODO: This is inefficient - we should maintain a link index
    let pages = garden.file_manager.list_pages().await?;
    for page_meta in pages {
        if page_meta.name == name {
            continue;
        }

        if let Ok(page) = garden.file_manager.read_page(&page_meta.name).await {
            for block in page.blocks.values() {
                if block_contains_reference(&block.content, &name, tag_name) {
                    backlinks.push(BacklinkRef {
                        page_name: page.name.clone(),
                        page_title: page.title.clone(),
                        block_uuid: block.uuid.to_string(),
                        block_content: block.content.clone(),
                        is_journal: false,
                        journal_date: None,
                    });
                }
            }
        }
    }

    // Also check journals
    let journals = garden.file_manager.list_journals().await?;
    for journal_meta in journals {
        if let Some(date) = journal_meta.journal_date {
            if let Ok(page) = garden.file_manager.read_journal(date).await {
                for block in page.blocks.values() {
                    if block_contains_reference(&block.content, &name, tag_name) {
                        backlinks.push(BacklinkRef {
                            page_name: page.name.clone(),
                            page_title: page.title.clone(),
                            block_uuid: block.uuid.to_string(),
                            block_content: block.content.clone(),
                            is_journal: true,
                            journal_date: Some(date.format("%Y-%m-%d").to_string()),
                        });
                    }
                }
            }
        }
    }

    Ok(Json(backlinks))
}
