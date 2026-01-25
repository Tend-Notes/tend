// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Git API routes

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use tend_git::{BackupResult, CommitDiff, CommitInfo, GitStatus, ImportResult, PushResult, RemoteResult};

use crate::error::AppError;
use crate::state::AppState;
use crate::ws::WsEvent;

#[derive(Debug, Deserialize)]
pub struct HistoryQuery {
    /// Maximum number of commits to return (default 50)
    pub limit: Option<u32>,
    /// Filter by file path (e.g., "pages/foo.md")
    pub path: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CommitRequest {
    /// Optional commit message. If not provided, auto-generates one.
    pub message: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RestoreRequest {
    /// The commit SHA to restore to
    pub commit: String,
    /// Optional file path to restore (e.g., "pages/foo.md"). If omitted, restores all files.
    pub path: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DiffQuery {
    /// Filter by file path (e.g., "pages/foo.md")
    pub path: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SetRemoteRequest {
    /// The remote URL (e.g., "git@github.com:user/repo.git")
    pub url: String,
}

/// Get git status
pub async fn status(State(state): State<Arc<AppState>>) -> Result<Json<GitStatus>, AppError> {
    let garden = state.garden.read().await;
    let status = garden.backup_manager.status()?;
    Ok(Json(status))
}

/// Trigger an auto-backup (scheduled/smart commit)
pub async fn backup(State(state): State<Arc<AppState>>) -> Result<Json<BackupResult>, AppError> {
    state.broadcast(WsEvent::BackupStarted);

    let garden = state.garden.read().await;

    // Acquire exclusive lock on file manager
    let _lock = garden.file_manager.acquire_exclusive_lock().await;

    match garden.backup_manager.backup() {
        Ok(result) => {
            state.broadcast(WsEvent::BackupCompleted {
                commit_sha: result.commit_sha.clone(),
                message: result.message.clone(),
            });
            Ok(Json(result))
        }
        Err(e) => {
            state.broadcast(WsEvent::BackupFailed {
                error: e.to_string(),
            });
            Err(e.into())
        }
    }
}

/// Create a commit (manual commit via command palette)
pub async fn commit(
    State(state): State<Arc<AppState>>,
    Json(request): Json<CommitRequest>,
) -> Result<Json<BackupResult>, AppError> {
    state.broadcast(WsEvent::BackupStarted);

    let garden = state.garden.read().await;

    // Acquire exclusive lock on file manager
    let _lock = garden.file_manager.acquire_exclusive_lock().await;

    match garden.backup_manager.commit(request.message.as_deref()) {
        Ok(result) => {
            state.broadcast(WsEvent::BackupCompleted {
                commit_sha: result.commit_sha.clone(),
                message: result.message.clone(),
            });
            Ok(Json(result))
        }
        Err(e) => {
            state.broadcast(WsEvent::BackupFailed {
                error: e.to_string(),
            });
            Err(e.into())
        }
    }
}

/// Get commit history
pub async fn history(
    State(state): State<Arc<AppState>>,
    Query(query): Query<HistoryQuery>,
) -> Result<Json<Vec<CommitInfo>>, AppError> {
    let garden = state.garden.read().await;
    let commits = garden.backup_manager.history(query.limit, query.path.as_deref())?;
    Ok(Json(commits))
}

/// Get diff for a specific commit
pub async fn diff(
    State(state): State<Arc<AppState>>,
    Path(commit_sha): Path<String>,
    Query(query): Query<DiffQuery>,
) -> Result<Json<CommitDiff>, AppError> {
    let garden = state.garden.read().await;
    let diff = garden.backup_manager.diff(&commit_sha, query.path.as_deref())?;
    Ok(Json(diff))
}

/// Restore to a specific commit, optionally for a single file
pub async fn restore(
    State(state): State<Arc<AppState>>,
    Json(request): Json<RestoreRequest>,
) -> Result<Json<BackupResult>, AppError> {
    let garden = state.garden.read().await;

    // Acquire exclusive lock on file manager
    let _lock = garden.file_manager.acquire_exclusive_lock().await;

    garden.backup_manager.restore(&request.commit, request.path.as_deref())?;

    // Return success result
    let message = if request.path.is_some() {
        "File restored successfully".to_string()
    } else {
        "Restored successfully".to_string()
    };
    Ok(Json(BackupResult {
        success: true,
        commit_sha: Some(request.commit),
        message,
        timestamp: chrono::Utc::now(),
    }))
}

/// Push to remote repository
pub async fn push(State(state): State<Arc<AppState>>) -> Result<Json<PushResult>, AppError> {
    state.broadcast(WsEvent::PushStarted);

    let garden = state.garden.read().await;

    match garden.backup_manager.push() {
        Ok(result) => {
            state.broadcast(WsEvent::PushCompleted {
                message: result.message.clone(),
            });
            Ok(Json(result))
        }
        Err(e) => {
            state.broadcast(WsEvent::PushFailed {
                error: e.to_string(),
            });
            Err(e.into())
        }
    }
}

/// Pull from remote repository
pub async fn pull(State(state): State<Arc<AppState>>) -> Result<Json<PushResult>, AppError> {
    let garden = state.garden.read().await;

    // Acquire exclusive lock since pull modifies files
    let _lock = garden.file_manager.acquire_exclusive_lock().await;

    let result = garden.backup_manager.pull()?;
    Ok(Json(result))
}

/// Set the remote repository URL
pub async fn set_remote(
    State(state): State<Arc<AppState>>,
    Json(request): Json<SetRemoteRequest>,
) -> Result<Json<RemoteResult>, AppError> {
    let garden = state.garden.read().await;
    let result = garden.backup_manager.set_remote(&request.url)?;
    Ok(Json(result))
}

/// Test connection to the remote repository
pub async fn test_remote(State(state): State<Arc<AppState>>) -> Result<Json<RemoteResult>, AppError> {
    let garden = state.garden.read().await;
    let result = garden.backup_manager.test_remote()?;
    Ok(Json(result))
}

/// Remove the remote repository
pub async fn remove_remote(State(state): State<Arc<AppState>>) -> Result<(), AppError> {
    let garden = state.garden.read().await;
    garden.backup_manager.remove_remote()?;
    Ok(())
}

/// Check if the remote repository contains a garden
pub async fn check_remote_garden(State(state): State<Arc<AppState>>) -> Result<Json<bool>, AppError> {
    let garden = state.garden.read().await;
    let has_garden = garden.backup_manager.check_remote_has_garden()?;
    Ok(Json(has_garden))
}

/// Import a garden from the remote repository
pub async fn import_remote_garden(State(state): State<Arc<AppState>>) -> Result<Json<ImportResult>, AppError> {
    let garden = state.garden.read().await;

    // Acquire exclusive lock since this modifies files
    let _lock = garden.file_manager.acquire_exclusive_lock().await;

    let result = garden.backup_manager.import_remote_garden()?;
    Ok(Json(result))
}
