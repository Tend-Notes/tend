// SPDX-License-Identifier: MIT WITH Commons-Clause
//! WebSocket handler for real-time notifications

use std::sync::Arc;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use tracing::{debug, warn};

use crate::state::AppState;

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
}

/// Sender for broadcasting events to all connected clients
pub type EventSender = broadcast::Sender<WsEvent>;

/// Create a new event broadcast channel
pub fn create_event_channel() -> (EventSender, broadcast::Receiver<WsEvent>) {
    broadcast::channel(100)
}

/// WebSocket upgrade handler
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

/// Handle a WebSocket connection
async fn handle_socket(socket: WebSocket, state: Arc<AppState>) {
    let (mut sender, mut receiver) = socket.split();

    // Subscribe to events
    let mut event_rx = state.event_sender.subscribe();

    // Send connected event
    let connected_msg = serde_json::to_string(&WsEvent::Connected).unwrap();
    if sender.send(Message::Text(connected_msg.into())).await.is_err() {
        return;
    }

    debug!("WebSocket client connected");

    // Spawn task to forward broadcast events to this client
    let mut send_task = tokio::spawn(async move {
        while let Ok(event) = event_rx.recv().await {
            let msg = match serde_json::to_string(&event) {
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

    debug!("WebSocket client disconnected");
}
