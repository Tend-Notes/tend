// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Block reference API routes
//!
//! Provides the API endpoint for looking up blocks by UUID.
//! Used for the ((uuid)) block reference syntax.

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use tend_core::{ContentType, Page};

use crate::auth::AuthenticatedUser;
use crate::error::AppError;
use crate::routes::gardens::load_user_content_types;
use crate::routes::helpers::{update_all_indices, update_all_indices_with_content_type};
use crate::state::{AppState, GardenState};
use crate::ws::{BroadcastEvent, WsEvent};

/// Response for a successful block lookup
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockResponse {
    /// The block UUID
    pub uuid: String,
    /// Name of the page containing this block
    pub page_name: String,
    /// The block's text content
    pub content: String,
    /// Whether this block has children
    pub has_children: bool,
}

/// Error response structure
#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Get a block by UUID
///
/// Returns the block content and metadata if found.
/// Returns 404 if the block is not found.
/// Returns 403 if the garden is encrypted (block references disabled).
pub async fn get_block(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Path(uuid): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;

    // Check if block index is available (not for encrypted gardens)
    let Some(block_index) = &garden.block_index else {
        return Ok((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: "feature_disabled".to_string(),
                reason: Some("block_references_require_unencrypted_garden".to_string()),
            }),
        )
            .into_response());
    };

    // Look up the block
    let index = block_index.lock().await;
    let block_ref = match index.lookup(&uuid) {
        Ok(Some(block_ref)) => block_ref,
        Ok(None) => {
            return Ok((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "block_not_found".to_string(),
                    reason: None,
                }),
            )
                .into_response());
        }
        Err(e) => {
            tracing::error!("Block index lookup error: {}", e);
            return Err(AppError::Internal(format!("Block index error: {}", e)));
        }
    };
    drop(index); // Release lock before reading page

    // Fetch the actual content from the page
    // Determine content type by parsing the page_name format:
    // - YYYY-MM-DD → journal
    // - directory/name → sheet (non-date)
    // - directory/YYYY-MM-DD/name → sheet (saveByDate)
    // - anything else → regular page
    let page: Page = if let Ok(date) = NaiveDate::parse_from_str(&block_ref.page_name, "%Y-%m-%d") {
        // This is a journal entry
        garden.file_manager.read_journal(date).await?
    } else if block_ref.page_name.contains('/') {
        // This is a sheet (custom content type)
        // Parse the path to extract directory, optional date, and name
        let parts: Vec<&str> = block_ref.page_name.splitn(3, '/').collect();

        if parts.len() < 2 {
            // Invalid format, fall back to page
            garden.file_manager.read_page(&block_ref.page_name).await?
        } else {
            let directory = parts[0];

            // Load content types to find the matching one by directory
            let content_types = load_user_content_types(&user.username)?;
            let content_type = content_types
                .iter()
                .find(|ct| ct.directory == directory && ct.id != "page" && ct.id != "journal");

            match content_type {
                Some(ct) => {
                    // Check if this is a saveByDate content type with date in path
                    if ct.is_date_foldered() && parts.len() == 3 {
                        // Format: directory/YYYY-MM-DD/name
                        let date = NaiveDate::parse_from_str(parts[1], "%Y-%m-%d").ok();
                        let name = parts[2];
                        garden.file_manager.read_sheet(ct, name, date).await?
                    } else {
                        // Format: directory/name (non-date content type)
                        // The remaining path after directory is the name
                        let name = &block_ref.page_name[directory.len() + 1..];
                        garden.file_manager.read_sheet(ct, name, None).await?
                    }
                }
                None => {
                    // No matching content type found, try as regular page
                    garden.file_manager.read_page(&block_ref.page_name).await?
                }
            }
        }
    } else {
        // Regular page
        garden.file_manager.read_page(&block_ref.page_name).await?
    };

    // Find the block in the page
    let uuid_parsed = uuid
        .parse::<uuid::Uuid>()
        .map_err(|_| AppError::BadRequest("Invalid UUID format".to_string()))?;

    let block = page
        .blocks
        .get(&uuid_parsed)
        .ok_or_else(|| AppError::NotFound("Block not found in page".to_string()))?;

    Ok(Json(BlockResponse {
        uuid: block.uuid.to_string(),
        page_name: block_ref.page_name,
        content: block.content.clone(),
        has_children: block_ref.has_children,
    })
    .into_response())
}

/// Response for block index status
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockIndexStatus {
    /// Whether block references are available
    pub available: bool,
    /// Number of blocks in the index (if available)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_count: Option<usize>,
    /// Reason why block references are unavailable (if applicable)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Get block index status
pub async fn status(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<Json<BlockIndexStatus>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;

    match &garden.block_index {
        Some(block_index) => {
            let index = block_index.lock().await;
            let count = index.len().unwrap_or(0);
            Ok(Json(BlockIndexStatus {
                available: true,
                block_count: Some(count),
                reason: None,
            }))
        }
        None => Ok(Json(BlockIndexStatus {
            available: false,
            block_count: None,
            reason: Some("encrypted_garden".to_string()),
        })),
    }
}

/// Response for rebuild operation
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RebuildResponse {
    pub block_count: usize,
    pub message: String,
}

/// Rebuild the block index from all pages
pub async fn rebuild(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<Json<RebuildResponse>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;

    let content_types = load_user_content_types(&user.username).unwrap_or_default();
    garden
        .rebuild_block_index(&content_types)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let block_count = if let Some(block_index) = &garden.block_index {
        block_index.lock().await.len().unwrap_or(0)
    } else {
        0
    };

    Ok(Json(RebuildResponse {
        block_count,
        message: format!("Block index rebuilt with {} blocks", block_count),
    }))
}

/// Where a block's page lives, and how to write it back.
enum SaveTarget {
    /// Regular page or journal — `write_page` handles both (via `page.is_journal`).
    /// The str is the index entity-type label ("page" or "journal").
    PageOrJournal(&'static str),
    /// Custom content-type sheet — needs the content type + optional date to save.
    Sheet(ContentType, Option<NaiveDate>),
}

/// Resolve a block's `page_name` to its loaded page and a save target. Mirrors the
/// content-type detection in `get_block` (journal / sheet / page), but also carries
/// what's needed to write the page back.
async fn load_page_for_block(
    garden: &GardenState,
    username: &str,
    page_name: &str,
) -> Result<(Page, SaveTarget), AppError> {
    if let Ok(date) = NaiveDate::parse_from_str(page_name, "%Y-%m-%d") {
        let page = garden.file_manager.read_journal(date).await?;
        return Ok((page, SaveTarget::PageOrJournal("journal")));
    }

    if page_name.contains('/') {
        let parts: Vec<&str> = page_name.splitn(3, '/').collect();
        if parts.len() >= 2 {
            let directory = parts[0];
            let content_types = load_user_content_types(username)?;
            let content_type = content_types
                .iter()
                .find(|ct| ct.directory == directory && ct.id != "page" && ct.id != "journal");
            if let Some(ct) = content_type {
                if ct.is_date_foldered() && parts.len() == 3 {
                    let date = NaiveDate::parse_from_str(parts[1], "%Y-%m-%d").ok();
                    let name = parts[2];
                    let page = garden.file_manager.read_sheet(ct, name, date).await?;
                    return Ok((page, SaveTarget::Sheet(ct.clone(), date)));
                }
                let name = &page_name[directory.len() + 1..];
                let page = garden.file_manager.read_sheet(ct, name, None).await?;
                return Ok((page, SaveTarget::Sheet(ct.clone(), None)));
            }
        }
    }

    let page = garden.file_manager.read_page(page_name).await?;
    Ok((page, SaveTarget::PageOrJournal("page")))
}

/// Request body for updating a single block by uuid.
#[derive(Debug, Deserialize)]
pub struct UpdateBlockRequest {
    /// New full block content (e.g. "DONE buy milk"). Omit to leave content unchanged.
    #[serde(default)]
    pub content: Option<String>,
    /// Properties to merge into the block. A `null` value deletes that key. Omit the
    /// whole field to leave properties unchanged.
    #[serde(default)]
    pub properties: Option<HashMap<String, Option<String>>>,
    /// Expected page version for optimistic concurrency. If provided and it doesn't
    /// match, returns 409 Conflict. If omitted, applies to the current on-disk state.
    #[serde(default)]
    pub version: Option<u64>,
    /// The origin page/journal/sheet name for this block, if the client already
    /// knows it (the task manager gets it from `/todos`). When present, the page is
    /// loaded directly instead of via the block index — so this works on encrypted
    /// gardens, where the block index is unavailable.
    #[serde(default)]
    pub page_name: Option<String>,
}

/// Response for a successful block update.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBlockResponse {
    pub uuid: String,
    pub page_name: String,
    pub content: String,
    pub properties: HashMap<String, String>,
    pub version: u64,
}

/// Update a single block by UUID, on whatever page/journal/sheet it lives on.
///
/// Lets the task manager change a task's status/text (via `content`) and its
/// priority/dates (via `properties`) without loading the owning page in an editor.
/// Performs a server-side read-modify-write of that page, then refreshes indices and
/// broadcasts `PageUpdated` so any open editor stays in sync.
pub async fn update_block(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Path(uuid): Path<String>,
    Json(req): Json<UpdateBlockRequest>,
) -> Result<impl IntoResponse, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;

    // Locate the block's owning page. Prefer a client-supplied page name (the task
    // manager knows it from /todos) so the edit works on encrypted gardens; only
    // fall back to a block-index lookup by uuid, which requires an unencrypted
    // garden.
    let (mut page, target) = if let Some(page_name) = req.page_name.as_deref() {
        load_page_for_block(&garden, &user.username, page_name).await?
    } else {
        // Block index (and thus uuid lookup) is unavailable for encrypted gardens.
        let Some(block_index) = &garden.block_index else {
            return Ok((
                StatusCode::FORBIDDEN,
                Json(ErrorResponse {
                    error: "feature_disabled".to_string(),
                    reason: Some("block_references_require_unencrypted_garden".to_string()),
                }),
            )
                .into_response());
        };
        let block_ref = {
            let index = block_index.lock().await;
            match index.lookup(&uuid) {
                Ok(Some(block_ref)) => block_ref,
                Ok(None) => {
                    return Ok((
                        StatusCode::NOT_FOUND,
                        Json(ErrorResponse {
                            error: "block_not_found".to_string(),
                            reason: None,
                        }),
                    )
                        .into_response());
                }
                Err(e) => {
                    tracing::error!("Block index lookup error: {}", e);
                    return Err(AppError::Internal(format!("Block index error: {}", e)));
                }
            }
        };
        load_page_for_block(&garden, &user.username, &block_ref.page_name).await?
    };

    // Optional optimistic-concurrency check.
    if let Some(expected) = req.version {
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

    let uuid_parsed = uuid
        .parse::<uuid::Uuid>()
        .map_err(|_| AppError::BadRequest("Invalid UUID format".to_string()))?;

    {
        let block = page
            .blocks
            .get_mut(&uuid_parsed)
            .ok_or_else(|| AppError::NotFound("Block not found in page".to_string()))?;

        if let Some(content) = req.content {
            block.content = content;
        }
        if let Some(props) = req.properties {
            for (key, value) in props {
                match value {
                    Some(v) => {
                        block.properties.insert(key, v);
                    }
                    None => {
                        block.properties.remove(&key);
                    }
                }
            }
        }
    }

    page.version += 1;
    page.touch();

    // Persist + refresh indices via the same paths the page/journal/sheet update
    // handlers use.
    match &target {
        SaveTarget::PageOrJournal(entity_type) => {
            garden.file_manager.write_page(&page).await?;
            update_all_indices(&garden, &page, entity_type).await;
        }
        SaveTarget::Sheet(content_type, date) => {
            garden
                .file_manager
                .write_sheet(content_type, &page, *date)
                .await?;
            update_all_indices_with_content_type(&garden, &page, "sheet", content_type, *date).await;
        }
    }

    // Broadcast so any open editor of this page reloads (ignore "no receivers").
    let _ = state.event_sender.send(BroadcastEvent {
        username: Some(user.username.clone()),
        event: WsEvent::PageUpdated {
            name: page.name.clone(),
        },
    });

    let block = page
        .blocks
        .get(&uuid_parsed)
        .expect("block still present after update");
    Ok(Json(UpdateBlockResponse {
        uuid: block.uuid.to_string(),
        page_name: page.name.clone(),
        content: block.content.clone(),
        properties: block.properties.clone(),
        version: page.version,
    })
    .into_response())
}
