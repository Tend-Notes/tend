// SPDX-License-Identifier: MIT WITH Commons-Clause
//! TODO aggregation API routes

use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use serde::Serialize;

use crate::auth::AuthenticatedUser;
use crate::error::AppError;
use crate::indices::TaskItem;
use crate::routes::gardens::load_user_content_types;
use crate::state::AppState;

/// List of all tasks across the garden
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskList {
    pub tasks: Vec<TaskItem>,
}

/// Get all tasks across all pages and journals
///
/// Uses an incremental index that is populated lazily on first request
/// and updated when pages are saved.
pub async fn list_todos(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<Json<TaskList>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;

    // Check if index needs to be populated (lazy initialization)
    let needs_rebuild = !garden.is_todo_index_populated().await;

    if needs_rebuild {
        // Get all content types for this garden (pages, journals, custom sheets)
        let content_types = load_user_content_types(&user.username).unwrap_or_default();

        // Rebuild the todo index from all content types
        if let Err(e) = garden.rebuild_todo_index(&content_types).await {
            tracing::warn!("Failed to rebuild todo index: {}", e);
            // Fall back to empty response rather than failing
            return Ok(Json(TaskList { tasks: vec![] }));
        }
    }

    // Get tasks from the index
    let todo_index = garden.todo_index.read().await;
    let tasks = todo_index.get_all_tasks();

    Ok(Json(TaskList { tasks }))
}
