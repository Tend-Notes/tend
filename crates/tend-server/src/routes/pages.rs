// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Page API routes

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use tend_core::{Block, Page, PageMeta};
use tracing::debug;

use crate::auth::AuthenticatedUser;
use crate::error::AppError;
use crate::state::AppState;
use crate::ws::{BroadcastEvent, WsEvent};

use super::gardens::load_user_content_types;
use super::helpers::{apply_block_updates, apply_property_updates, remove_from_all_indices, update_all_indices};
use tend_core::ContentType;

/// List all pages
pub async fn list_pages(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<Json<Vec<PageMeta>>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;
    let pages = garden.file_manager.list_pages().await?;
    Ok(Json(pages))
}

/// Request body for creating a page
#[derive(Debug, Deserialize)]
pub struct CreatePageRequest {
    pub name: String,
    pub content: Option<String>,
}

/// Create a new page (idempotent - returns existing page if it already exists)
pub async fn create_page(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Json(req): Json<CreatePageRequest>,
) -> Result<Json<Page>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;

    // If page already exists, return it (idempotent behavior to avoid race conditions
    // when multiple requests try to create the same page simultaneously)
    if garden.file_manager.page_exists(&req.name).await {
        let existing_page = garden.file_manager.read_page(&req.name).await?;
        debug!("Page already exists, returning existing: {}", req.name);
        return Ok(Json(existing_page));
    }

    let mut page = Page::new(&req.name);

    // Add initial content if provided, otherwise create an empty block
    // (matching journal behavior for consistency)
    let block = Block::new(req.content.unwrap_or_default());
    page.add_block(block);

    garden.file_manager.write_page(&page).await?;

    // Index the new page (if search is enabled)
    if let Some(search_index) = &garden.search_index {
        let mut index = search_index.write().await;
        index.index_page(&page)?;
        index.maybe_commit()?;
    }

    // Update link index
    {
        let blocks: Vec<_> = page.blocks.values().cloned().collect();
        let mut link_index = garden.link_index.write().await;
        if let Err(e) = link_index.index_page(&page.name, &blocks).await {
            tracing::warn!("Failed to update link index for page {}: {}", page.name, e);
        }
    }

    // Update block index (if available - not for encrypted gardens)
    if let Some(block_index) = &garden.block_index {
        let mut index = block_index.lock().await;
        if let Err(e) = index.update_page(&page) {
            tracing::warn!("Failed to update block index for page {}: {}", page.name, e);
        }
    }

    debug!("Created page: {}", req.name);
    Ok(Json(page))
}

/// System tag pages - these are readonly synthetic pages that explain save status
const SYSTEM_TAGS: &[(&str, &str)] = &[
    ("saved", "Your changes have been saved to the local filesystem. The file exists on disk but has not yet been committed to version control."),
    ("stored", "Your changes have been committed to the local Git repository. The data is version-controlled locally but has not yet been pushed to a remote backup."),
    ("backed up", "Your changes have been pushed to the remote Git repository. The data is fully backed up and safe."),
    ("unsaved", "You have changes that have not yet been saved to disk. These exist only in your browser and will be lost if you close the tab."),
];

/// Create a synthetic readonly page for system tags
fn create_system_tag_page(tag_name: &str, description: &str) -> Page {
    let page_name = format!("tags/{}", tag_name);
    let mut page = Page::new(&page_name);

    // Add description block
    let mut block = Block::new(description);
    block.properties.insert("readonly".to_string(), "true".to_string());
    page.add_block(block);

    // Mark the page as readonly
    page.properties.insert("readonly".to_string(), "true".to_string());

    page
}

/// Create a synthetic page for a user tag (shows just the tag name as title)
fn create_user_tag_page(tag_name: &str) -> Page {
    let page_name = format!("tags/{}", tag_name);
    let mut page = Page::new(&page_name);

    // Add a description block
    let block = Block::new(format!("Pages and blocks tagged with #{}.", tag_name));
    page.add_block(block);

    page
}

/// Get a page by name
pub async fn get_page(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Path(name): Path<String>,
) -> Result<Json<Page>, AppError> {
    // Check if this is a tag page
    if name.starts_with("tags/") {
        let tag_name = name.strip_prefix("tags/").unwrap();

        // Check for system tags first
        for (system_tag, description) in SYSTEM_TAGS {
            if tag_name == *system_tag {
                return Ok(Json(create_system_tag_page(system_tag, description)));
            }
        }

        // For user tags, create a synthetic page (backlinks will show references)
        return Ok(Json(create_user_tag_page(tag_name)));
    }

    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;
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
    /// Page-level property changes to merge (Some = set, None = remove). Omitted
    /// keys are left untouched.
    #[serde(default)]
    pub properties: std::collections::HashMap<String, Option<String>>,
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
    user: AuthenticatedUser,
    Path(name): Path<String>,
    Json(req): Json<UpdatePageRequest>,
) -> Result<Json<Page>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;

    // Read existing page or create new
    let mut page = garden
        .file_manager
        .read_page(&name)
        .await
        .unwrap_or_else(|_| Page::new(&name));

    // Apply block updates (version check, clear, parse, add blocks, bump version)
    apply_block_updates(&mut page, req.blocks, req.version)?;
    apply_property_updates(&mut page, req.properties);

    garden.file_manager.write_page(&page).await?;

    // Update all indices (search, link, block)
    update_all_indices(&garden, &page, "page").await;

    // Broadcast update to other clients (ignore send errors - no receivers is ok)
    let _ = state.event_sender.send(BroadcastEvent {
        username: Some(user.username.clone()),
        event: WsEvent::PageUpdated { name: name.clone() },
    });

    debug!("Updated page: {} (version {})", name, page.version);
    Ok(Json(page))
}

/// Delete a page
pub async fn delete_page(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Path(name): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;
    garden.file_manager.delete_page(&name).await?;

    // Remove from all indices (search, link, block, tag, todo)
    remove_from_all_indices(&garden, &name, "page", &ContentType::page(), None).await;

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

/// Get backlinks to a page using the link index
///
/// This uses the hashed link index for O(1) lookup of backlinks, then loads
/// only the pages that actually contain links (much faster than scanning all pages).
pub async fn get_backlinks(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Path(name): Path<String>,
) -> Result<Json<Vec<BacklinkRef>>, AppError> {
    use std::collections::{HashMap, HashSet};
    use tend_links::hash_page_name;

    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;
    let mut backlinks = Vec::new();

    // Determine the target name for the link index lookup
    // For tag pages (tags/tagname), we look up the tag name directly
    let lookup_name = if name.starts_with("tags/") {
        name.strip_prefix("tags/").unwrap().to_string()
    } else {
        name.clone()
    };

    // Query the link index for backlinks
    let backlink_results = {
        let link_index = garden.link_index.read().await;
        link_index.get_backlinks(&lookup_name)
    };

    if backlink_results.is_empty() {
        return Ok(Json(backlinks));
    }

    // Collect unique source hashes and their block UUIDs
    let source_hashes: HashSet<String> = backlink_results
        .iter()
        .map(|r| r.source_hash.clone())
        .collect();

    // Build a map of source_hash -> block_uuids for efficient lookup
    let mut source_blocks: HashMap<String, HashSet<String>> = HashMap::new();
    for result in &backlink_results {
        source_blocks
            .entry(result.source_hash.clone())
            .or_default()
            .insert(result.block_uuid.to_string());
    }

    // Scan ALL content types for source pages
    let content_types = load_user_content_types(&user.username).unwrap_or_default();

    for ct in &content_types {
        // Resolve which pages exist from filenames only (no reads/decrypts),
        // then read ONLY the pages whose hash is a backlink source. Previously
        // this list_sheets'd (read+parsed) the whole garden just to find them.
        let sheets = garden.file_manager.list_sheet_names(ct).await?;
        for sheet_meta in &sheets {
            let page_hash = hash_page_name(&sheet_meta.name);
            if !source_hashes.contains(&page_hash) {
                continue;
            }

            if let Some(page) = garden.load_sheet_from_meta(ct, sheet_meta).await {
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

    Ok(Json(backlinks))
}
