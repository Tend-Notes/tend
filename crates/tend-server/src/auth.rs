// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Authentication middleware for multi-tenant user isolation
//!
//! Extracts the authenticated user from headers set by a reverse proxy (e.g., Authelia).
//! In production, the reverse proxy sets the `Remote-User` header after authentication.
//! In development mode, users can be simulated via the `X-Dev-User` header.

use axum::{
    extract::FromRequestParts,
    http::{request::Parts, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::sync::Arc;

use crate::config::Config;
use crate::state::AppState;

/// Authenticated user extracted from request headers
#[derive(Clone, Debug)]
pub struct AuthenticatedUser {
    /// The username from the auth header
    pub username: String,
}

/// Error returned when authentication fails
#[derive(Debug)]
pub enum AuthError {
    /// No authentication header present and auth is required
    MissingHeader,
    /// Username in header is invalid (e.g., contains path traversal)
    InvalidUsername(String),
    /// Auth required but no default user configured for dev mode
    NoDefaultUser,
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            AuthError::MissingHeader => (
                StatusCode::UNAUTHORIZED,
                "Authentication required",
            ),
            AuthError::InvalidUsername(_msg) => (
                StatusCode::BAD_REQUEST,
                "Invalid username",
            ),
            AuthError::NoDefaultUser => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "No default user configured for development mode",
            ),
        };

        let body = Json(json!({ "error": message }));
        (status, body).into_response()
    }
}

/// Validates that a username is safe for use in filesystem paths.
/// This is a security-critical function to prevent path traversal attacks.
pub(crate) fn validate_username(username: &str) -> Result<(), AuthError> {
    if username.is_empty() {
        return Err(AuthError::InvalidUsername("Username cannot be empty".into()));
    }
    if username.contains("..") {
        return Err(AuthError::InvalidUsername("Username cannot contain '..'".into()));
    }
    if username.contains('/') || username.contains('\\') {
        return Err(AuthError::InvalidUsername("Username cannot contain path separators".into()));
    }
    if username.contains('\0') {
        return Err(AuthError::InvalidUsername("Username cannot contain null bytes".into()));
    }
    if username.starts_with('.') {
        return Err(AuthError::InvalidUsername("Username cannot start with '.'".into()));
    }
    // Reject Windows drive letters
    if username.len() >= 2 && username.chars().nth(1) == Some(':') {
        return Err(AuthError::InvalidUsername("Invalid username format".into()));
    }
    // Length limit for sanity
    if username.len() > 64 {
        return Err(AuthError::InvalidUsername("Username too long".into()));
    }
    Ok(())
}

/// Extract username from headers based on config
fn extract_username_from_headers(
    headers: &HeaderMap,
    config: &Config,
) -> Result<String, AuthError> {
    // Try the primary auth header first (set by reverse proxy like Authelia)
    if let Some(value) = headers.get(&config.auth.user_header) {
        if let Ok(username) = value.to_str() {
            let username = username.trim().to_string();
            if !username.is_empty() {
                validate_username(&username)?;
                return Ok(username);
            }
        }
    }

    // In dev mode (auth not required), check dev user header
    if !config.auth.required {
        if let Some(value) = headers.get(&config.auth.dev_user_header) {
            if let Ok(username) = value.to_str() {
                let username = username.trim().to_string();
                if !username.is_empty() {
                    validate_username(&username)?;
                    return Ok(username);
                }
            }
        }

        // Fall back to default user in dev mode
        if let Some(ref default_user) = config.auth.default_user {
            validate_username(default_user)?;
            return Ok(default_user.clone());
        }

        return Err(AuthError::NoDefaultUser);
    }

    // Auth required but no header present
    Err(AuthError::MissingHeader)
}

impl FromRequestParts<Arc<AppState>> for AuthenticatedUser {
    type Rejection = AuthError;

    fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> impl std::future::Future<Output = Result<Self, Self::Rejection>> + Send {
        let result = extract_username_from_headers(&parts.headers, &state.config)
            .map(|username| AuthenticatedUser { username });
        std::future::ready(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_username() {
        // Valid usernames
        assert!(validate_username("john").is_ok());
        assert!(validate_username("john_doe").is_ok());
        assert!(validate_username("john-doe").is_ok());
        assert!(validate_username("john123").is_ok());
        assert!(validate_username("JOHN").is_ok());

        // Invalid: path traversal
        assert!(validate_username("..").is_err());
        assert!(validate_username("../admin").is_err());
        assert!(validate_username("john/../admin").is_err());

        // Invalid: path separators
        assert!(validate_username("john/doe").is_err());
        assert!(validate_username("john\\doe").is_err());

        // Invalid: starts with dot
        assert!(validate_username(".hidden").is_err());

        // Invalid: empty
        assert!(validate_username("").is_err());

        // Invalid: null bytes
        assert!(validate_username("john\0doe").is_err());

        // Invalid: too long
        assert!(validate_username(&"a".repeat(65)).is_err());
        assert!(validate_username(&"a".repeat(64)).is_ok());
    }
}
