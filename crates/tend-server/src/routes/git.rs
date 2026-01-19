// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Git API routes

use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use tend_git::{BackupResult, GitStatus};

use crate::error::AppError;
use crate::state::AppState;

/// Get git status
pub async fn status(
    State(state): State<Arc<AppState>>,
) -> Result<Json<GitStatus>, AppError> {
    let status = state.backup_manager.status()?;
    Ok(Json(status))
}

/// Trigger a backup
pub async fn backup(
    State(state): State<Arc<AppState>>,
) -> Result<Json<BackupResult>, AppError> {
    // Acquire exclusive lock on file manager
    let _lock = state.file_manager.acquire_exclusive_lock().await;

    let result = state.backup_manager.backup()?;
    Ok(Json(result))
}
