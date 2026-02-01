// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Link index API routes

use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use serde::Serialize;

use crate::auth::AuthenticatedUser;
use crate::error::AppError;
use crate::state::AppState;

/// Response for link index status
#[derive(Serialize)]
pub struct LinkIndexStatus {
    /// Number of link entries in the index
    pub entries: usize,
}

/// Get link index status
pub async fn status(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<Json<LinkIndexStatus>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;
    let link_index = garden.link_index.read().await;

    Ok(Json(LinkIndexStatus {
        entries: link_index.len(),
    }))
}

/// Response for rebuild operation
#[derive(Serialize)]
pub struct RebuildResponse {
    pub entries: usize,
    pub message: String,
}

/// Rebuild the link index from all pages and journals
pub async fn rebuild(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<Json<RebuildResponse>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;

    garden
        .rebuild_link_index()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let link_index = garden.link_index.read().await;
    let entries = link_index.len();

    Ok(Json(RebuildResponse {
        entries,
        message: format!("Link index rebuilt with {} entries", entries),
    }))
}
