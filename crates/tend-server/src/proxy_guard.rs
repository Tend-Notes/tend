// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Trusted-proxy edge gate.
//!
//! The server authenticates by trusting a `Remote-User` header set by the
//! reverse proxy (see `auth.rs`). That trust is only sound if the request
//! actually came from the proxy. This middleware enforces that: when auth is
//! required, a request whose TCP peer is not in the configured trusted-proxy
//! set is rejected with `403` before it reaches routing or the auth extractor —
//! on every channel (REST API, SPA assets, WebSocket upgrade).
//!
//! The only exception is the unauthenticated health endpoint, so external
//! liveness checks keep working.
//!
//! In dev mode (`auth.required = false`) the gate is inactive: local dev talks
//! to the backend directly over loopback, which is trusted anyway, and the
//! `TEND_DEV_ALLOW_INSECURE` LAN-dev path must keep working.

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use axum::extract::{ConnectInfo, Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

/// Path that stays reachable from any peer (liveness checks). Must match the
/// route registered in `routes::api_router` nested under `/api/v1`.
const PUBLIC_HEALTH_PATH: &str = "/api/v1/health";

/// Shared state for the guard: parsed trusted networks and whether the gate is
/// active. Cheap to clone (an `Arc` plus a bool).
#[derive(Clone)]
pub struct ProxyGuard {
    enabled: bool,
    trusted: Arc<Vec<ipnet::IpNet>>,
}

impl ProxyGuard {
    /// Build from config. `enabled` should be `config.auth.required`.
    pub fn new(enabled: bool, trusted: Vec<ipnet::IpNet>) -> Self {
        Self {
            enabled,
            trusted: Arc::new(trusted),
        }
    }
}

/// Normalize IPv4-mapped IPv6 addresses (`::ffff:a.b.c.d`) to their IPv4 form so
/// a `127.0.0.1/32` rule matches a loopback peer seen over a dual-stack socket.
fn normalize(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(IpAddr::V6(v6)),
        v4 => v4,
    }
}

/// Pure allow/deny decision, split out for testing.
///
/// Returns `true` if the request should be allowed to proceed.
fn is_allowed(enabled: bool, trusted: &[ipnet::IpNet], path: &str, peer: IpAddr) -> bool {
    if !enabled {
        return true;
    }
    if path == PUBLIC_HEALTH_PATH {
        return true;
    }
    let peer = normalize(peer);
    trusted.iter().any(|net| net.contains(&peer))
}

/// Axum middleware entry point.
pub async fn guard(
    State(guard): State<ProxyGuard>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    req: Request,
    next: Next,
) -> Response {
    let path = req.uri().path().to_string();
    if is_allowed(guard.enabled, &guard.trusted, &path, peer.ip()) {
        next.run(req).await
    } else {
        tracing::warn!(
            "Rejected request from untrusted peer {} for {} (not in trusted-proxy set)",
            peer.ip(),
            path
        );
        StatusCode::FORBIDDEN.into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn nets(entries: &[&str]) -> Vec<ipnet::IpNet> {
        entries
            .iter()
            .map(|e| ipnet::IpNet::from_str(e).unwrap())
            .collect()
    }

    fn ip(s: &str) -> IpAddr {
        IpAddr::from_str(s).unwrap()
    }

    #[test]
    fn loopback_peer_is_allowed() {
        let t = nets(&["127.0.0.1/32", "::1/128"]);
        assert!(is_allowed(true, &t, "/api/v1/pages", ip("127.0.0.1")));
        assert!(is_allowed(true, &t, "/api/v1/pages", ip("::1")));
    }

    #[test]
    fn untrusted_peer_is_rejected() {
        let t = nets(&["127.0.0.1/32"]);
        assert!(!is_allowed(true, &t, "/api/v1/pages", ip("10.0.0.5")));
        assert!(!is_allowed(true, &t, "/ws", ip("192.168.1.20")));
        assert!(!is_allowed(true, &t, "/", ip("203.0.113.7"))); // SPA route
    }

    #[test]
    fn health_is_public_even_from_untrusted_peer() {
        let t = nets(&["127.0.0.1/32"]);
        assert!(is_allowed(true, &t, "/api/v1/health", ip("203.0.113.7")));
    }

    #[test]
    fn disabled_gate_allows_everything() {
        let t = nets(&["127.0.0.1/32"]);
        assert!(is_allowed(false, &t, "/api/v1/pages", ip("203.0.113.7")));
    }

    #[test]
    fn subnet_rule_matches_container_peer() {
        let t = nets(&["172.18.0.0/16"]);
        assert!(is_allowed(true, &t, "/api/v1/pages", ip("172.18.0.9")));
        assert!(!is_allowed(true, &t, "/api/v1/pages", ip("172.19.0.9")));
    }

    #[test]
    fn ipv4_mapped_v6_peer_matches_v4_rule() {
        let t = nets(&["127.0.0.1/32"]);
        assert!(is_allowed(true, &t, "/api/v1/pages", ip("::ffff:127.0.0.1")));
    }

    #[test]
    fn empty_trusted_set_rejects_all_but_health() {
        let t: Vec<ipnet::IpNet> = vec![];
        assert!(!is_allowed(true, &t, "/api/v1/pages", ip("127.0.0.1")));
        assert!(is_allowed(true, &t, "/api/v1/health", ip("127.0.0.1")));
    }
}
