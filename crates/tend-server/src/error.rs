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
    Internal(String),
    Storage(tend_storage::StorageError),
    Search(tend_search::SearchError),
    Git(tend_git::GitError),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, msg),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg),
            AppError::Internal(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg),
            AppError::Storage(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
            AppError::Search(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
            AppError::Git(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
        };

        let body = Json(json!({
            "error": message,
        }));

        (status, body).into_response()
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
