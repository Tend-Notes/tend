// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Git API routes

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use tend_git::{BackupManager, BackupResult, CommitDiff, CommitInfo, GitError, GitStatus, ImportResult, PushResult, RemoteGardenInfo, RemoteResult};

use crate::auth::AuthenticatedUser;
use crate::error::AppError;
use crate::state::AppState;
use crate::ws::WsEvent;

/// Run a blocking `BackupManager` operation on the blocking thread pool so a
/// slow git call (network push/pull, subprocess fork) can't park a tokio worker
/// and stall unrelated requests. `BackupManager` is a cheap `Clone` (path +
/// flag), so we hand an owned copy to the closure.
async fn run_git<T, F>(bm: BackupManager, f: F) -> Result<T, GitError>
where
    F: FnOnce(&BackupManager) -> Result<T, GitError> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(move || f(&bm))
        .await
        .map_err(|e| GitError::OperationFailed(format!("git task panicked: {e}")))?
}

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
pub async fn status(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<Json<GitStatus>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let bm = user_state.garden.read().await.backup_manager.clone();
    let status = run_git(bm, |b| b.status()).await?;
    Ok(Json(status))
}

/// Trigger an auto-backup (scheduled/smart commit)
pub async fn backup(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<Json<BackupResult>, AppError> {
    state.broadcast_to_user(&user.username, WsEvent::BackupStarted);

    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;

    // Acquire exclusive lock on file manager
    let _lock = garden.file_manager.acquire_exclusive_lock().await;

    let bm = garden.backup_manager.clone();
    match run_git(bm, |b| b.backup()).await {
        Ok(result) => {
            state.broadcast_to_user(&user.username, WsEvent::BackupCompleted {
                commit_sha: result.commit_sha.clone(),
                message: result.message.clone(),
            });
            Ok(Json(result))
        }
        Err(e) => {
            state.broadcast_to_user(&user.username, WsEvent::BackupFailed {
                error: e.to_string(),
            });
            Err(e.into())
        }
    }
}

/// Create a commit (manual commit via command palette)
pub async fn commit(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Json(request): Json<CommitRequest>,
) -> Result<Json<BackupResult>, AppError> {
    state.broadcast_to_user(&user.username, WsEvent::BackupStarted);

    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;

    // Acquire exclusive lock on file manager
    let _lock = garden.file_manager.acquire_exclusive_lock().await;

    let bm = garden.backup_manager.clone();
    let message = request.message.clone();
    match run_git(bm, move |b| b.commit(message.as_deref())).await {
        Ok(result) => {
            state.broadcast_to_user(&user.username, WsEvent::BackupCompleted {
                commit_sha: result.commit_sha.clone(),
                message: result.message.clone(),
            });
            Ok(Json(result))
        }
        Err(e) => {
            state.broadcast_to_user(&user.username, WsEvent::BackupFailed {
                error: e.to_string(),
            });
            Err(e.into())
        }
    }
}

/// Get commit history
pub async fn history(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Query(query): Query<HistoryQuery>,
) -> Result<Json<Vec<CommitInfo>>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let bm = user_state.garden.read().await.backup_manager.clone();
    let (limit, path) = (query.limit, query.path.clone());
    let commits = run_git(bm, move |b| b.history(limit, path.as_deref())).await?;
    Ok(Json(commits))
}

/// Get diff for a specific commit
pub async fn diff(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Path(commit_sha): Path<String>,
    Query(query): Query<DiffQuery>,
) -> Result<Json<CommitDiff>, AppError> {
    tend_git::validate_commit_sha(&commit_sha).map_err(|e| AppError::BadRequest(e.to_string()))?;
    let user_state = state.get_user_state(&user.username).await?;
    let bm = user_state.garden.read().await.backup_manager.clone();
    let path = query.path.clone();
    let diff = run_git(bm, move |b| b.diff(&commit_sha, path.as_deref())).await?;
    Ok(Json(diff))
}

/// Restore to a specific commit, optionally for a single file
pub async fn restore(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Json(request): Json<RestoreRequest>,
) -> Result<Json<BackupResult>, AppError> {
    tend_git::validate_commit_sha(&request.commit).map_err(|e| AppError::BadRequest(e.to_string()))?;
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;

    // Acquire exclusive lock on file manager
    let _lock = garden.file_manager.acquire_exclusive_lock().await;

    let bm = garden.backup_manager.clone();
    let (commit, path) = (request.commit.clone(), request.path.clone());
    run_git(bm, move |b| b.restore(&commit, path.as_deref())).await?;

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
pub async fn push(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<Json<PushResult>, AppError> {
    state.broadcast_to_user(&user.username, WsEvent::PushStarted);

    let user_state = state.get_user_state(&user.username).await?;
    let bm = user_state.garden.read().await.backup_manager.clone();

    match run_git(bm, |b| b.push()).await {
        Ok(result) => {
            state.broadcast_to_user(&user.username, WsEvent::PushCompleted {
                message: result.message.clone(),
            });
            Ok(Json(result))
        }
        Err(e) => {
            state.broadcast_to_user(&user.username, WsEvent::PushFailed {
                error: e.to_string(),
            });
            Err(e.into())
        }
    }
}

/// Pull from remote repository
pub async fn pull(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<Json<PushResult>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;

    // Acquire exclusive lock since pull modifies files
    let _lock = garden.file_manager.acquire_exclusive_lock().await;

    let bm = garden.backup_manager.clone();
    let result = run_git(bm, |b| b.pull()).await?;
    Ok(Json(result))
}

/// Set the remote repository URL
pub async fn set_remote(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Json(request): Json<SetRemoteRequest>,
) -> Result<Json<RemoteResult>, AppError> {
    // Validate at the route boundary so a rejected URL is a 400, not a 500.
    tend_git::validate_remote_url(&request.url)
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    let user_state = state.get_user_state(&user.username).await?;
    let bm = user_state.garden.read().await.backup_manager.clone();
    let url = request.url.clone();
    let result = run_git(bm, move |b| b.set_remote(&url)).await?;
    Ok(Json(result))
}

/// Test connection to the remote repository
pub async fn test_remote(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<Json<RemoteResult>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let bm = user_state.garden.read().await.backup_manager.clone();
    let result = run_git(bm, |b| b.test_remote()).await?;
    Ok(Json(result))
}

/// Remove the remote repository
pub async fn remove_remote(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<(), AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let bm = user_state.garden.read().await.backup_manager.clone();
    run_git(bm, |b| b.remove_remote()).await?;
    Ok(())
}

/// Check if the remote repository contains a garden
pub async fn check_remote_garden(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<Json<RemoteGardenInfo>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let bm = user_state.garden.read().await.backup_manager.clone();
    let garden_info = run_git(bm, |b| b.check_remote_has_garden()).await?;
    Ok(Json(garden_info))
}

/// Import a garden from the remote repository
pub async fn import_remote_garden(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<Json<ImportResult>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;

    // Acquire exclusive lock since this modifies files
    let _lock = garden.file_manager.acquire_exclusive_lock().await;

    let bm = garden.backup_manager.clone();
    let result = run_git(bm, |b| b.import_remote_garden()).await?;
    Ok(Json(result))
}
