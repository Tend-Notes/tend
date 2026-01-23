// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Tend Server - Web server for the Tend digital garden

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::{routing::get, Router};
use tend_storage::{FileEvent, SimpleFileWatcher};
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use tracing::{error, info, warn, Level};

mod config;
mod error;
mod routes;
mod state;
mod ws;

use config::Config;
use state::AppState;
use ws::WsEvent;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_max_level(Level::DEBUG)
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("tend=debug".parse()?)
                .add_directive("tower_http=debug".parse()?),
        )
        .init();

    // Load configuration
    let config = Config::load()?;
    info!("Loaded configuration");
    info!("Data directory: {}", config.data_dir.display());

    // Initialize application state
    let state = AppState::new(&config).await?;
    let state = Arc::new(state);

    // Start scheduled backup task if enabled
    if config.git.enabled && config.git.backup_interval_minutes > 0 {
        let backup_state = Arc::clone(&state);
        let interval_minutes = config.git.backup_interval_minutes;

        tokio::spawn(async move {
            let interval = Duration::from_secs(interval_minutes as u64 * 60);
            info!("Scheduled backup enabled: every {} minutes", interval_minutes);

            loop {
                tokio::time::sleep(interval).await;

                info!("Running scheduled backup...");
                backup_state.broadcast(WsEvent::BackupStarted);

                // Acquire garden lock and run backup
                let garden = backup_state.garden.read().await;
                let _lock = garden.file_manager.acquire_exclusive_lock().await;
                match garden.backup_manager.backup() {
                    Ok(result) => {
                        if result.commit_sha.is_some() {
                            info!("Scheduled backup completed: {}", result.message);
                        } else {
                            info!("Scheduled backup: {}", result.message);
                        }
                        backup_state.broadcast(WsEvent::BackupCompleted {
                            commit_sha: result.commit_sha,
                            message: result.message,
                        });
                    }
                    Err(e) => {
                        warn!("Scheduled backup failed: {}", e);
                        backup_state.broadcast(WsEvent::BackupFailed {
                            error: e.to_string(),
                        });
                    }
                }
            }
        });
    }

    // Start search index TTL cleanup task for encrypted gardens
    // Checks every hour if the search index should be cleaned up due to inactivity
    {
        let ttl_state = Arc::clone(&state);
        tokio::spawn(async move {
            let check_interval = Duration::from_secs(3600); // Check every hour
            loop {
                tokio::time::sleep(check_interval).await;

                let garden = ttl_state.garden.read().await;
                // Only check encrypted gardens with TTL enabled
                if garden.encrypted && garden.search_config.ttl_hours > 0 {
                    if garden.is_index_expired().await {
                        info!("Search index TTL expired for encrypted garden, cleaning up...");
                        if let Err(e) = garden.delete_search_index().await {
                            warn!("Failed to delete expired search index: {}", e);
                        }
                    }
                }
            }
        });
    }

    // Start file watcher for real-time updates
    // Note: The file watcher watches the initial garden. When switching gardens,
    // file change notifications from the old garden will be ignored since paths won't match.
    // A proper solution would restart the watcher on garden switch.
    {
        let watcher_state = Arc::clone(&state);
        let garden = state.garden.read().await;
        let pending_writes = garden.file_manager.pending_writes();
        let root = garden.data_dir.clone();
        drop(garden); // Release lock before spawning

        match SimpleFileWatcher::new(&root, pending_writes) {
            Ok(watcher) => {
                let mut rx = watcher.subscribe();

                tokio::spawn(async move {
                    // Keep watcher alive
                    let _watcher = watcher;

                    info!("File watcher started for: {}", root.display());

                    while let Ok(event) = rx.recv().await {
                        // Check if this is still the active garden
                        let current_root = {
                            let garden = watcher_state.garden.read().await;
                            garden.data_dir.clone()
                        };

                        // Skip events if garden has changed
                        if current_root != root {
                            continue;
                        }

                        // Convert file path to page name
                        let (path, event_type) = match &event {
                            FileEvent::Created(p) | FileEvent::Modified(p) => {
                                (p.clone(), "modified")
                            }
                            FileEvent::Deleted(p) => (p.clone(), "deleted"),
                            FileEvent::Renamed { to, .. } => (to.clone(), "renamed"),
                        };

                        // Extract relative path from root
                        let relative = path
                            .strip_prefix(&root)
                            .unwrap_or(&path)
                            .to_string_lossy()
                            .to_string();

                        info!("File {} externally: {}", event_type, relative);

                        // Broadcast the event
                        watcher_state.broadcast(WsEvent::FileChanged {
                            path: relative,
                        });
                    }
                });
            }
            Err(e) => {
                error!("Failed to start file watcher: {}", e);
            }
        }
    }

    // Build CORS layer based on configuration
    let cors_layer = if config.cors.allowed_origins.is_empty() {
        // No origins configured = same-origin only (most restrictive)
        info!("CORS: same-origin only (no cross-origin requests allowed)");
        CorsLayer::new()
    } else if config.cors.allowed_origins.len() == 1 && config.cors.allowed_origins[0] == "*" {
        // Wildcard = allow all origins (least restrictive, for development/trusted proxies)
        info!("CORS: allowing all origins (permissive mode)");
        CorsLayer::permissive()
    } else {
        // Specific origins listed
        use axum::http::HeaderValue;
        let origins: Vec<HeaderValue> = config
            .cors
            .allowed_origins
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect();
        info!("CORS: allowing specific origins: {:?}", config.cors.allowed_origins);
        CorsLayer::new()
            .allow_origin(origins)
            .allow_methods(tower_http::cors::Any)
            .allow_headers(tower_http::cors::Any)
    };

    // Build router
    let app = Router::new()
        .nest("/api/v1", routes::api_router())
        .route("/ws", get(ws::ws_handler))
        .fallback_service(ServeDir::new(&config.static_dir).append_index_html_on_directories(true))
        .layer(TraceLayer::new_for_http())
        .layer(cors_layer)
        .with_state(state);

    // Start server
    let addr = SocketAddr::new(config.host, config.port);
    info!("Starting server at http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
