// SPDX-License-Identifier: MIT WITH Commons-Clause
//! WebSocket handler for real-time notifications

use std::sync::atomic::Ordering;
use std::sync::Arc;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use tracing::{debug, info, warn};

use crate::state::{AppState, MAX_WS_CONNECTIONS};

/// Events that can be broadcast to connected clients
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WsEvent {
    /// Backup started
    BackupStarted,

    /// Backup completed successfully
    BackupCompleted {
        commit_sha: Option<String>,
        message: String,
    },

    /// Backup failed
    BackupFailed { error: String },

    /// Push to remote started
    PushStarted,

    /// Push completed
    PushCompleted { message: String },

    /// Push failed
    PushFailed { error: String },

    /// File changed externally
    FileChanged { path: String },

    /// Page updated (by another client or external edit)
    PageUpdated { name: String },

    /// Connection established (sent on connect)
    Connected,

    /// Garden was switched (hot-reload)
    GardenSwitched { garden_id: String },
}

/// A broadcast event with optional user targeting
#[derive(Debug, Clone)]
pub struct BroadcastEvent {
    /// Target username (None = broadcast to all users)
    pub username: Option<String>,
    /// The actual event to send
    pub event: WsEvent,
}

/// Sender for broadcasting events to connected clients
pub type EventSender = broadcast::Sender<BroadcastEvent>;

/// Create a new event broadcast channel
pub fn create_event_channel() -> (EventSender, broadcast::Receiver<BroadcastEvent>) {
    broadcast::channel(100)
}

/// Extract username from headers (matches auth.rs logic)
fn extract_username(headers: &HeaderMap, config: &crate::config::Config) -> Option<String> {
    // Try the configured user header (e.g., Remote-User from Authelia)
    if let Some(value) = headers.get(&config.auth.user_header) {
        if let Ok(username) = value.to_str() {
            if !username.is_empty() {
                return Some(username.to_string());
            }
        }
    }

    // In dev mode, try the dev header
    if !config.auth.required {
        if let Some(value) = headers.get(&config.auth.dev_user_header) {
            if let Ok(username) = value.to_str() {
                if !username.is_empty() {
                    return Some(username.to_string());
                }
            }
        }
        // Fall back to default user
        return config.auth.default_user.clone();
    }

    None
}

/// Outcome of verifying a WebSocket handshake against the auth service.
enum AuthOutcome {
    /// The auth service rejected the session.
    Rejected,
    /// The session is valid and the auth service reported this identity.
    Verified(String),
    /// The session is valid but the auth service did not return an identity
    /// (some proxy setups omit the user header on the verify response).
    VerifiedNoIdentity,
}

/// Verify authentication by forwarding cookies to the auth service (e.g., Authelia)
///
/// Authelia's /api/verify endpoint requires specific headers to verify the request:
/// - X-Original-URL: The full original request URL
/// - X-Forwarded-Proto: The protocol (http/https)
/// - X-Forwarded-Host: The original host
/// - X-Forwarded-Uri: The URI path
/// - X-Forwarded-Method: The HTTP method
/// - Cookie: Session cookies
///
/// On success the auth service echoes the authenticated identity back in its
/// user header (e.g. `Remote-User`); we route events by *that*, never the
/// client-supplied header, so a proxy-bypassing client can't impersonate.
async fn verify_auth(
    verify_url: &str,
    headers: &HeaderMap,
    config: &crate::config::Config,
) -> AuthOutcome {
    // Extract cookie header to forward
    let cookie_header = headers
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    // Extract forwarded headers from the reverse proxy
    let forwarded_for = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let forwarded_proto = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("https");

    let forwarded_host = headers
        .get("x-forwarded-host")
        .or_else(|| headers.get("host"))
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    // Build X-Original-URL for Authelia
    let original_url = format!("{}://{}/ws", forwarded_proto, forwarded_host);

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            warn!("Failed to create HTTP client for auth verification: {}", e);
            return AuthOutcome::Rejected;
        }
    };

    let mut request = client
        .get(verify_url)
        .header("Cookie", cookie_header)
        .header("X-Original-URL", &original_url)
        .header("X-Forwarded-Proto", forwarded_proto)
        .header("X-Forwarded-Host", forwarded_host)
        .header("X-Forwarded-Uri", "/ws")
        .header("X-Forwarded-Method", "GET");

    if !forwarded_for.is_empty() {
        request = request.header("X-Forwarded-For", forwarded_for);
    }

    debug!(
        "Verifying WebSocket auth: url={}, original_url={}, host={}",
        verify_url, original_url, forwarded_host
    );

    match request.send().await {
        Ok(response) => {
            let status = response.status();
            if !status.is_success() {
                info!(
                    "WebSocket auth verification failed: status {} for {}",
                    status, original_url
                );
                return AuthOutcome::Rejected;
            }
            // Read the authenticated identity the auth service echoes back.
            let identity = response
                .headers()
                .get(&config.auth.user_header)
                .and_then(|v| v.to_str().ok())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            match identity {
                Some(user) => {
                    debug!("WebSocket auth verification succeeded for {}", user);
                    AuthOutcome::Verified(user)
                }
                None => {
                    debug!("WebSocket auth verification succeeded (no identity header)");
                    AuthOutcome::VerifiedNoIdentity
                }
            }
        }
        Err(e) => {
            warn!("WebSocket auth verification request failed: {}", e);
            AuthOutcome::Rejected
        }
    }
}

/// Reject cross-origin WebSocket handshakes (WS bypasses CORS, so a malicious
/// web page could otherwise open `ws://host/ws` on the user's ambient cookies).
/// Same-origin only — the shared helper is passed an empty allowlist.
fn origin_allowed(headers: &HeaderMap) -> bool {
    crate::origin::origin_allowed(headers, &[])
}

/// WebSocket upgrade handler
pub async fn ws_handler(
    headers: HeaderMap,
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, StatusCode> {
    // Reject cross-origin handshakes before doing any auth work.
    if !origin_allowed(&headers) {
        info!("WebSocket connection rejected: disallowed Origin");
        return Err(StatusCode::FORBIDDEN);
    }

    // Resolve the username to route events by. When an auth service is
    // configured, trust the identity *it* returns, not the client's header.
    let username = if let Some(verify_url) = &state.config.auth.verify_url {
        match verify_auth(verify_url, &headers, &state.config).await {
            AuthOutcome::Rejected => {
                info!("WebSocket connection rejected: authentication failed");
                return Err(StatusCode::UNAUTHORIZED);
            }
            AuthOutcome::Verified(verified) => {
                // Refuse if the client claims a different Remote-User than the
                // one the auth service verified (proxy-bypass impersonation).
                if let Some(claimed) = extract_username(&headers, &state.config) {
                    if claimed != verified {
                        warn!(
                            "WebSocket connection rejected: claimed user does not match verified session"
                        );
                        return Err(StatusCode::FORBIDDEN);
                    }
                }
                verified
            }
            AuthOutcome::VerifiedNoIdentity => {
                // Session is valid but the proxy gave us no identity; fall back
                // to the client header (best available) and validate it below.
                warn!("WebSocket auth returned no identity; routing by client header");
                match extract_username(&headers, &state.config) {
                    Some(u) => u,
                    None => return Err(StatusCode::UNAUTHORIZED),
                }
            }
        }
    } else {
        // No auth service (dev mode): use the header/default-user logic.
        match extract_username(&headers, &state.config) {
            Some(u) => u,
            None => return Err(StatusCode::UNAUTHORIZED),
        }
    };

    // Reject usernames unsafe for filesystem paths.
    if crate::auth::validate_username(&username).is_err() {
        warn!("WebSocket connection rejected: invalid username");
        return Err(StatusCode::BAD_REQUEST);
    }

    // Check the server-wide connection limit before upgrading.
    let current = state.ws_connection_count.load(Ordering::Relaxed);
    if current >= MAX_WS_CONNECTIONS {
        warn!(
            "WebSocket connection limit reached ({}/{})",
            current, MAX_WS_CONNECTIONS
        );
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }

    // Reserve a per-user slot so one identity can't exhaust every slot.
    if !state.try_acquire_ws_slot(&username) {
        warn!("WebSocket per-user connection limit reached");
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }

    Ok(ws.on_upgrade(move |socket| handle_socket(socket, state, Some(username))))
}

/// Handle a WebSocket connection
async fn handle_socket(socket: WebSocket, state: Arc<AppState>, my_username: Option<String>) {
    // Increment connection count
    let count = state.ws_connection_count.fetch_add(1, Ordering::Relaxed) + 1;
    debug!(
        "WebSocket client connected ({} active, user: {:?})",
        count,
        my_username.as_deref().unwrap_or("anonymous")
    );

    // Ensure we decrement the global and per-user counts on exit
    let _guard = scopeguard::guard((Arc::clone(&state), my_username.clone()), |(s, user)| {
        let remaining = s.ws_connection_count.fetch_sub(1, Ordering::Relaxed) - 1;
        if let Some(user) = user {
            s.release_ws_slot(&user);
        }
        debug!("WebSocket client disconnected ({} active)", remaining);
    });

    let (mut sender, mut receiver) = socket.split();

    // Subscribe to events
    let mut event_rx = state.event_sender.subscribe();

    // Send connected event
    let connected_msg = serde_json::to_string(&WsEvent::Connected).unwrap();
    if sender.send(Message::Text(connected_msg.into())).await.is_err() {
        return;
    }

    // Spawn task to forward broadcast events to this client
    // Only send events targeted to this user or broadcast to all (username = None)
    let mut send_task = tokio::spawn(async move {
        while let Ok(broadcast_event) = event_rx.recv().await {
            // Filter: skip events targeted to a different user
            if let Some(ref target_user) = broadcast_event.username {
                if my_username.as_ref() != Some(target_user) {
                    continue; // Event is for a different user
                }
            }

            let msg = match serde_json::to_string(&broadcast_event.event) {
                Ok(json) => json,
                Err(e) => {
                    warn!("Failed to serialize event: {}", e);
                    continue;
                }
            };

            if sender.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    // Handle incoming messages (mostly just pings/pongs, we don't expect client messages)
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Close(_) => break,
                Message::Ping(data) => {
                    // Pong is handled automatically by axum
                    debug!("Received ping: {:?}", data);
                }
                Message::Text(text) => {
                    debug!("Received text message: {}", text);
                    // Could handle client commands here in the future
                }
                _ => {}
            }
        }
    });

    // Wait for either task to finish
    tokio::select! {
        _ = &mut send_task => {
            recv_task.abort();
        }
        _ = &mut recv_task => {
            send_task.abort();
        }
    }
    // _guard drop will log disconnect and decrement counter
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::header::HeaderName;
    use axum::http::HeaderValue;

    fn hm(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.insert(
                HeaderName::from_bytes(k.as_bytes()).unwrap(),
                HeaderValue::from_str(v).unwrap(),
            );
        }
        h
    }

    #[test]
    fn origin_allowed_permits_same_origin() {
        let h = hm(&[("host", "tend.example"), ("origin", "https://tend.example")]);
        assert!(origin_allowed(&h));
    }

    #[test]
    fn origin_allowed_refuses_cross_origin() {
        let h = hm(&[("host", "tend.example"), ("origin", "https://evil.example")]);
        assert!(!origin_allowed(&h));
    }

    #[test]
    fn origin_allowed_permits_missing_origin() {
        // Non-browser clients send no Origin and carry no ambient cookies.
        let h = hm(&[("host", "tend.example")]);
        assert!(origin_allowed(&h));
    }

    #[test]
    fn origin_allowed_prefers_forwarded_host() {
        let h = hm(&[
            ("host", "internal:3000"),
            ("x-forwarded-host", "tend.example"),
            ("origin", "https://tend.example"),
        ]);
        assert!(origin_allowed(&h));
    }
}
