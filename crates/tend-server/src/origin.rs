// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Shared cross-origin request check.
//!
//! Used in two places:
//! - the WebSocket handshake (`ws.rs`), which bypasses CORS entirely, and
//! - the CSRF guard on state-changing HTTP requests (`csrf.rs`).
//!
//! A same-origin browser sends an `Origin` matching the host it reached. A
//! non-browser client (curl, the mobile app) sends no `Origin` and carries no
//! ambient cookies to abuse, so it is allowed. A present-but-mismatched `Origin`
//! is refused unless it appears in the configured allowlist (the same origins
//! accepted by CORS).

use axum::http::HeaderMap;

/// Return true if the request's `Origin` is same-origin, absent, or in
/// `allowed_origins`. Pass an empty slice for same-origin-only.
pub fn origin_allowed(headers: &HeaderMap, allowed_origins: &[String]) -> bool {
    let origin = match headers.get("origin").and_then(|v| v.to_str().ok()) {
        Some(o) => o,
        None => return true, // no Origin: not a browser cross-site request
    };

    // Explicit allowlist (matches the CORS policy) — compare the full origin.
    if allowed_origins.iter().any(|o| o == origin) {
        return true;
    }

    // Same-origin: the host the client actually reached (proxy-forwarded first,
    // then Host), compared against the Origin's host[:port] authority.
    let expected_host = headers
        .get("x-forwarded-host")
        .or_else(|| headers.get("host"))
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let origin_host = origin
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(origin);
    !expected_host.is_empty() && origin_host == expected_host
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hm(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.insert(
                axum::http::HeaderName::from_bytes(k.as_bytes()).unwrap(),
                v.parse().unwrap(),
            );
        }
        h
    }

    #[test]
    fn same_origin_allowed() {
        let h = hm(&[("host", "tend.example"), ("origin", "https://tend.example")]);
        assert!(origin_allowed(&h, &[]));
    }

    #[test]
    fn cross_origin_refused() {
        let h = hm(&[("host", "tend.example"), ("origin", "https://evil.example")]);
        assert!(!origin_allowed(&h, &[]));
    }

    #[test]
    fn no_origin_allowed() {
        let h = hm(&[("host", "tend.example")]);
        assert!(origin_allowed(&h, &[]));
    }

    #[test]
    fn allowlisted_cross_origin_allowed() {
        let h = hm(&[("host", "tend.example"), ("origin", "https://app.example")]);
        assert!(origin_allowed(&h, &["https://app.example".to_string()]));
    }

    #[test]
    fn forwarded_host_takes_precedence() {
        let h = hm(&[
            ("host", "127.0.0.1:3000"),
            ("x-forwarded-host", "tend.example"),
            ("origin", "https://tend.example"),
        ]);
        assert!(origin_allowed(&h, &[]));
    }
}
