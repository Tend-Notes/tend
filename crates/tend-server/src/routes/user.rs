// SPDX-License-Identifier: MIT WITH Commons-Clause
//! User preferences and state API routes
//!
//! Stores user preferences and UI state on the server for multi-tenant support.
//! Files are stored in the user's directory: $TEND_BASE_DIR/users/$username/

use std::path::Path;
use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::Value;

use crate::auth::AuthenticatedUser;
use crate::config::{ensure_user_dir, user_prefs_path, user_state_path};
use crate::state::AppState;

/// Read a per-user JSON file.
///
/// A missing, unreadable or unparseable file all answer `{}`: these are UI
/// preferences, and an empty object means "no preferences yet", which is
/// exactly how the client treats a first-time user.
fn read_user_json(path: &Path, username: &str, what: &str) -> Response {
    if !path.exists() {
        return Json(serde_json::json!({})).into_response();
    }

    match std::fs::read_to_string(path) {
        Ok(content) => match serde_json::from_str::<Value>(&content) {
            Ok(value) => Json(value).into_response(),
            Err(e) => {
                tracing::warn!("Failed to parse {} for {}: {}", what, username, e);
                Json(serde_json::json!({})).into_response()
            }
        },
        Err(e) => {
            tracing::warn!("Failed to read {} for {}: {}", what, username, e);
            Json(serde_json::json!({})).into_response()
        }
    }
}

/// Write a per-user JSON file with owner-only permissions, creating the user
/// directory first. Answers 204 on success.
fn write_user_json(path: &Path, username: &str, what: &str, value: &Value) -> Response {
    if let Err(e) = ensure_user_dir(username) {
        tracing::error!("Failed to create user dir for {}: {}", username, e);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create user directory",
        )
            .into_response();
    }

    let content = match serde_json::to_string_pretty(value) {
        Ok(content) => content,
        Err(e) => {
            tracing::error!("Failed to serialize {}: {}", what, e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to serialize payload",
            )
                .into_response();
        }
    };

    if let Err(e) = std::fs::write(path, content) {
        tracing::error!("Failed to write {} for {}: {}", what, username, e);
        return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to save payload").into_response();
    }

    // Set restrictive permissions (0600 - owner read/write only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }

    StatusCode::NO_CONTENT.into_response()
}

/// Get user preferences
///
/// Returns the user's preferences as a JSON object, or an empty object if none exist.
pub async fn get_prefs(user: AuthenticatedUser, _state: State<Arc<AppState>>) -> impl IntoResponse {
    read_user_json(&user_prefs_path(&user.username), &user.username, "prefs")
}

/// Save user preferences
///
/// Accepts any JSON object and saves it as the user's preferences.
pub async fn put_prefs(
    user: AuthenticatedUser,
    _state: State<Arc<AppState>>,
    Json(prefs): Json<Value>,
) -> impl IntoResponse {
    write_user_json(
        &user_prefs_path(&user.username),
        &user.username,
        "prefs",
        &prefs,
    )
}

/// Get user UI state
///
/// Returns the user's UI state as a JSON object, or an empty object if none exists.
pub async fn get_state(user: AuthenticatedUser, _state: State<Arc<AppState>>) -> impl IntoResponse {
    read_user_json(&user_state_path(&user.username), &user.username, "state")
}

/// Save user UI state
///
/// Accepts any JSON object and saves it as the user's UI state.
pub async fn put_state(
    user: AuthenticatedUser,
    _state: State<Arc<AppState>>,
    Json(ui_state): Json<Value>,
) -> impl IntoResponse {
    write_user_json(
        &user_state_path(&user.username),
        &user.username,
        "state",
        &ui_state,
    )
}
