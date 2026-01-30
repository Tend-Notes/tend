// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Tend Server - Web server for the Tend digital garden

use std::net::SocketAddr;
use std::num::NonZeroU32;
use std::sync::Arc;
use std::time::Duration;

use axum::{routing::get, Router};
use tend_storage::{FileEvent, SimpleFileWatcher};
use tokio::sync::broadcast;
use tower_governor::governor::GovernorConfigBuilder;
use tower_governor::GovernorLayer;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
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
    // Default: info level for tower_http (suppresses per-request logs)
    // Override with RUST_LOG=tower_http=debug for request tracing
    tracing_subscriber::fmt()
        .with_max_level(Level::DEBUG)
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("tend=debug".parse()?)
                .add_directive("tower_http=info".parse()?),
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
    // The watcher automatically restarts when gardens are switched by subscribing
    // to GardenSwitched events.
    {
        let watcher_state = Arc::clone(&state);

        tokio::spawn(async move {
            // Subscribe to events so we know when to restart
            let mut event_rx = watcher_state.event_sender.subscribe();

            loop {
                // Get current garden info
                let (root, pending_writes) = {
                    let garden = watcher_state.garden.read().await;
                    (garden.data_dir.clone(), garden.file_manager.pending_writes())
                };

                // Create watcher for current garden
                let watcher_result = SimpleFileWatcher::new(&root, pending_writes);
                let (watcher, mut file_rx) = match watcher_result {
                    Ok(w) => {
                        let rx = w.subscribe();
                        info!("File watcher started for: {}", root.display());
                        (Some(w), rx)
                    }
                    Err(e) => {
                        error!("Failed to start file watcher for {}: {}", root.display(), e);
                        // Wait a bit before retrying or for garden switch
                        tokio::time::sleep(Duration::from_secs(5)).await;
                        continue;
                    }
                };

                // Process events until garden switches
                loop {
                    tokio::select! {
                        // Handle file events
                        file_event = file_rx.recv() => {
                            match file_event {
                                Ok(event) => {
                                    let (path, event_type) = match &event {
                                        FileEvent::Created(p) | FileEvent::Modified(p) => {
                                            (p.clone(), "modified")
                                        }
                                        FileEvent::Deleted(p) => (p.clone(), "deleted"),
                                        FileEvent::Renamed { to, .. } => (to.clone(), "renamed"),
                                    };

                                    let relative = path
                                        .strip_prefix(&root)
                                        .unwrap_or(&path)
                                        .to_string_lossy()
                                        .to_string();

                                    info!("File {} externally: {}", event_type, relative);

                                    watcher_state.broadcast(WsEvent::FileChanged {
                                        path: relative,
                                    });
                                }
                                Err(broadcast::error::RecvError::Closed) => {
                                    warn!("File watcher channel closed, restarting...");
                                    break;
                                }
                                Err(broadcast::error::RecvError::Lagged(n)) => {
                                    warn!("File watcher missed {} events", n);
                                }
                            }
                        }
                        // Handle garden switch events
                        ws_event = event_rx.recv() => {
                            match ws_event {
                                Ok(WsEvent::GardenSwitched { garden_id }) => {
                                    info!("Garden switched to {}, restarting file watcher", garden_id);
                                    // Drop current watcher by breaking inner loop
                                    drop(watcher);
                                    break;
                                }
                                Ok(_) => {
                                    // Ignore other events
                                }
                                Err(broadcast::error::RecvError::Closed) => {
                                    error!("Event channel closed, stopping file watcher");
                                    return;
                                }
                                Err(broadcast::error::RecvError::Lagged(n)) => {
                                    warn!("File watcher missed {} WS events", n);
                                }
                            }
                        }
                    }
                }
            }
        });
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

    // Build rate limiting layer if enabled
    let rate_limit_layer = if config.rate_limit.enabled {
        let rps = NonZeroU32::new(config.rate_limit.requests_per_second).unwrap_or(NonZeroU32::MIN);
        let burst = NonZeroU32::new(config.rate_limit.burst_size).unwrap_or(NonZeroU32::MIN);

        info!(
            "Rate limiting enabled: {} req/s, burst {}",
            config.rate_limit.requests_per_second, config.rate_limit.burst_size
        );

        let governor_config = GovernorConfigBuilder::default()
            .per_second(rps.get() as u64)
            .burst_size(burst.get())
            .finish()
            .expect("Invalid rate limit configuration");

        Some(GovernorLayer::new(Arc::new(governor_config)))
    } else {
        info!("Rate limiting disabled");
        None
    };

    // Log WebSocket auth configuration
    if let Some(ref verify_url) = config.auth.verify_url {
        info!("WebSocket auth enabled: verifying against {}", verify_url);
    } else {
        info!("WebSocket auth disabled (no TEND_AUTH_VERIFY_URL configured)");
    }

    // Build router with API routes (rate-limited) and static files (not rate-limited)
    let api_router = Router::new()
        .nest("/api/v1", routes::api_router())
        .route("/ws", get(ws::ws_handler));

    // Apply rate limiting only to API routes if enabled
    let api_router = if let Some(layer) = rate_limit_layer {
        api_router.layer(layer)
    } else {
        api_router
    };

    // SPA fallback: serve index.html for any unmatched routes (client-side routing)
    let index_path = config.static_dir.join("index.html");
    let static_service = ServeDir::new(&config.static_dir)
        .append_index_html_on_directories(true)
        .fallback(ServeFile::new(&index_path));

    let app = api_router
        .fallback_service(static_service)
        .layer(TraceLayer::new_for_http())
        .layer(cors_layer)
        .with_state(state);

    // Start server
    let addr = SocketAddr::new(config.host, config.port);
    info!("Starting server at http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    Ok(())
}
