// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Block reference API routes
//!
//! Provides the API endpoint for looking up blocks by UUID.
//! Used for the ((uuid)) block reference syntax.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use chrono::NaiveDate;
use serde::Serialize;
use tend_core::Page;

use crate::auth::AuthenticatedUser;
use crate::error::AppError;
use crate::routes::gardens::load_user_content_types;
use crate::state::AppState;

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
