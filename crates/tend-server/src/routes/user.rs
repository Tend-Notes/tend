// SPDX-License-Identifier: MIT WITH Commons-Clause
//! User preferences and state API routes
//!
//! Stores user preferences and UI state on the server for multi-tenant support.
//! Files are stored in the user's directory: $TEND_BASE_DIR/users/$username/

use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::Value;

use crate::auth::AuthenticatedUser;
use crate::config::{ensure_user_dir, user_prefs_path, user_state_path};
use crate::state::AppState;

/// Get user preferences
///
/// Returns the user's preferences as a JSON object, or an empty object if none exist.
pub async fn get_prefs(
    user: AuthenticatedUser,
    _state: State<Arc<AppState>>,
) -> impl IntoResponse {
    let path = user_prefs_path(&user.username);

    if path.exists() {
        match std::fs::read_to_string(&path) {
            Ok(content) => match serde_json::from_str::<Value>(&content) {
                Ok(prefs) => Json(prefs).into_response(),
                Err(e) => {
                    tracing::warn!("Failed to parse prefs for {}: {}", user.username, e);
                    Json(serde_json::json!({})).into_response()
                }
            },
            Err(e) => {
                tracing::warn!("Failed to read prefs for {}: {}", user.username, e);
                Json(serde_json::json!({})).into_response()
            }
        }
    } else {
        Json(serde_json::json!({})).into_response()
    }
}

/// Save user preferences
///
/// Accepts any JSON object and saves it as the user's preferences.
pub async fn put_prefs(
    user: AuthenticatedUser,
    _state: State<Arc<AppState>>,
    Json(prefs): Json<Value>,
) -> impl IntoResponse {
    // Ensure user directory exists
    if let Err(e) = ensure_user_dir(&user.username) {
        tracing::error!("Failed to create user dir for {}: {}", user.username, e);
        return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create user directory").into_response();
    }

    let path = user_prefs_path(&user.username);

    match serde_json::to_string_pretty(&prefs) {
        Ok(content) => {
            if let Err(e) = std::fs::write(&path, content) {
                tracing::error!("Failed to write prefs for {}: {}", user.username, e);
                return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to save preferences").into_response();
            }

            // Set restrictive permissions (0600 - owner read/write only)
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
            }

            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => {
            tracing::error!("Failed to serialize prefs: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to serialize preferences").into_response()
        }
    }
}

/// Get user UI state
///
/// Returns the user's UI state as a JSON object, or an empty object if none exists.
pub async fn get_state(
    user: AuthenticatedUser,
    _state: State<Arc<AppState>>,
) -> impl IntoResponse {
    let path = user_state_path(&user.username);

    if path.exists() {
        match std::fs::read_to_string(&path) {
            Ok(content) => match serde_json::from_str::<Value>(&content) {
                Ok(state) => Json(state).into_response(),
                Err(e) => {
                    tracing::warn!("Failed to parse state for {}: {}", user.username, e);
                    Json(serde_json::json!({})).into_response()
                }
            },
            Err(e) => {
                tracing::warn!("Failed to read state for {}: {}", user.username, e);
                Json(serde_json::json!({})).into_response()
            }
        }
    } else {
        Json(serde_json::json!({})).into_response()
    }
}

/// Save user UI state
///
/// Accepts any JSON object and saves it as the user's UI state.
pub async fn put_state(
    user: AuthenticatedUser,
    _state: State<Arc<AppState>>,
    Json(ui_state): Json<Value>,
) -> impl IntoResponse {
    // Ensure user directory exists
    if let Err(e) = ensure_user_dir(&user.username) {
        tracing::error!("Failed to create user dir for {}: {}", user.username, e);
        return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create user directory").into_response();
    }

    let path = user_state_path(&user.username);

    match serde_json::to_string_pretty(&ui_state) {
        Ok(content) => {
            if let Err(e) = std::fs::write(&path, content) {
                tracing::error!("Failed to write state for {}: {}", user.username, e);
                return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to save state").into_response();
            }

            // Set restrictive permissions (0600 - owner read/write only)
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
            }

            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => {
            tracing::error!("Failed to serialize state: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to serialize state").into_response()
        }
    }
}
