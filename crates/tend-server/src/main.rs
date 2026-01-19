// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Tend Server - Web server for the Tend digital garden

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::{routing::get, Router};
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use tracing::{info, warn, Level};

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

                // Acquire lock and run backup
                let _lock = backup_state.file_manager.acquire_exclusive_lock().await;
                match backup_state.backup_manager.backup() {
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

    // Build router
    let app = Router::new()
        .nest("/api/v1", routes::api_router())
        .route("/ws", get(ws::ws_handler))
        .fallback_service(ServeDir::new(&config.static_dir).append_index_html_on_directories(true))
        .layer(TraceLayer::new_for_http())
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .with_state(state);

    // Start server
    let addr = SocketAddr::new(config.host, config.port);
    info!("Starting server at http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
