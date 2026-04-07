// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Tags API routes

use std::sync::Arc;

use axum::extract::State;
use axum::Json;

use crate::auth::AuthenticatedUser;
use crate::error::AppError;
use crate::indices::TagInfo;
use crate::routes::gardens::load_user_content_types;
use crate::state::AppState;

/// List all tags used across the garden
///
/// Uses an incremental index that is populated lazily on first request
/// and updated when pages are saved.
pub async fn list_tags(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<Json<Vec<TagInfo>>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;

    // Check if index needs to be populated (lazy initialization)
    let needs_rebuild = !garden.is_tag_index_populated().await;

    if needs_rebuild {
        let content_types = load_user_content_types(&user.username).unwrap_or_default();
        if let Err(e) = garden.rebuild_tag_index(&content_types).await {
            tracing::warn!("Failed to rebuild tag index: {}", e);
            // Fall back to empty response rather than failing
            return Ok(Json(vec![]));
        }
    }

    // Get tags from the index
    let tag_index = garden.tag_index.read().await;
    let tags = tag_index.get_all_tags();

    Ok(Json(tags))
}
