// SPDX-License-Identifier: MIT WITH Commons-Clause
//! CSRF guard for state-changing requests.
//!
//! Authentication is delegated to the reverse proxy, which turns a browser
//! cookie into a `Remote-User` header. That means a cross-site page can cause
//! the browser to send an authenticated request — a classic CSRF setup. Most
//! JSON endpoints are incidentally protected because the `application/json`
//! content type forces a CORS preflight, but parameter-less action POSTs (git
//! backup/push/pull, reindex, rebuild) and the `multipart/form-data` import are
//! submittable by a plain cross-site `<form>` with no preflight.
//!
//! This middleware rejects mutating requests (POST/PUT/DELETE/PATCH) whose
//! `Origin` is cross-site, using the same allowlist as CORS and the WebSocket
//! handshake. It is active only when auth is required; in dev there is no proxy
//! cookie to abuse, and the cross-origin dev frontend must keep working.

use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::{Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::origin::origin_allowed;

/// Shared state: whether the guard is active and the same allowlist CORS uses.
#[derive(Clone)]
pub struct CsrfConfig {
    enabled: bool,
    allowed_origins: Arc<Vec<String>>,
}

impl CsrfConfig {
    pub fn new(enabled: bool, allowed_origins: Vec<String>) -> Self {
        Self {
            enabled,
            allowed_origins: Arc::new(allowed_origins),
        }
    }
}

/// Methods that change state and therefore need CSRF protection.
fn is_mutating(method: &Method) -> bool {
    matches!(
        method,
        &Method::POST | &Method::PUT | &Method::DELETE | &Method::PATCH
    )
}

/// Axum middleware entry point.
pub async fn guard(State(cfg): State<CsrfConfig>, req: Request, next: Next) -> Response {
    if cfg.enabled && is_mutating(req.method()) && !origin_allowed(req.headers(), &cfg.allowed_origins)
    {
        tracing::warn!(
            "Rejected cross-origin {} {} (CSRF guard)",
            req.method(),
            req.uri().path()
        );
        return StatusCode::FORBIDDEN.into_response();
    }
    next.run(req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mutating_methods_detected() {
        assert!(is_mutating(&Method::POST));
        assert!(is_mutating(&Method::PUT));
        assert!(is_mutating(&Method::DELETE));
        assert!(is_mutating(&Method::PATCH));
        assert!(!is_mutating(&Method::GET));
        assert!(!is_mutating(&Method::HEAD));
        assert!(!is_mutating(&Method::OPTIONS));
    }
}
