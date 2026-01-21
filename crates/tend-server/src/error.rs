// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Error handling for the server

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

/// Application error type
#[derive(Debug)]
pub enum AppError {
    NotFound(String),
    BadRequest(String),
    Unauthorized(String),
    Internal(String),
    Storage(tend_storage::StorageError),
    Search(tend_search::SearchError),
    Git(tend_git::GitError),
    /// Version conflict - another client modified the resource
    Conflict {
        current_version: u64,
        message: String,
    },
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        match self {
            AppError::NotFound(msg) => {
                let body = Json(json!({ "error": msg }));
                (StatusCode::NOT_FOUND, body).into_response()
            }
            AppError::BadRequest(msg) => {
                let body = Json(json!({ "error": msg }));
                (StatusCode::BAD_REQUEST, body).into_response()
            }
            AppError::Unauthorized(msg) => {
                let body = Json(json!({ "error": msg }));
                (StatusCode::UNAUTHORIZED, body).into_response()
            }
            AppError::Internal(msg) => {
                let body = Json(json!({ "error": msg }));
                (StatusCode::INTERNAL_SERVER_ERROR, body).into_response()
            }
            AppError::Storage(e) => {
                let body = Json(json!({ "error": e.to_string() }));
                (StatusCode::INTERNAL_SERVER_ERROR, body).into_response()
            }
            AppError::Search(e) => {
                let body = Json(json!({ "error": e.to_string() }));
                (StatusCode::INTERNAL_SERVER_ERROR, body).into_response()
            }
            AppError::Git(e) => {
                let body = Json(json!({ "error": e.to_string() }));
                (StatusCode::INTERNAL_SERVER_ERROR, body).into_response()
            }
            AppError::Conflict {
                current_version,
                message,
            } => {
                let body = Json(json!({
                    "error": message,
                    "code": "VERSION_CONFLICT",
                    "currentVersion": current_version,
                }));
                (StatusCode::CONFLICT, body).into_response()
            }
        }
    }
}

impl From<tend_storage::StorageError> for AppError {
    fn from(e: tend_storage::StorageError) -> Self {
        match e {
            tend_storage::StorageError::NotFound(msg) => AppError::NotFound(msg),
            _ => AppError::Storage(e),
        }
    }
}

impl From<tend_search::SearchError> for AppError {
    fn from(e: tend_search::SearchError) -> Self {
        AppError::Search(e)
    }
}

impl From<tend_git::GitError> for AppError {
    fn from(e: tend_git::GitError) -> Self {
        AppError::Git(e)
    }
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        AppError::Internal(e.to_string())
    }
}
