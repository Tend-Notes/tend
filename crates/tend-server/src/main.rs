// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Tend Server - Web server for the Tend digital garden

use std::net::SocketAddr;
use std::num::NonZeroU32;
use std::sync::Arc;

use axum::{routing::get, Router};
use tower_governor::governor::GovernorConfigBuilder;
use tower_governor::GovernorLayer;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use tracing::{info, warn, Level};

mod auth;
mod config;
mod error;
mod routes;
mod state;
mod ws;

use config::Config;
use state::AppState;

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

    // Initialize application state (multi-tenant - no gardens loaded at startup)
    let state = AppState::new(&config).await?;
    let state = Arc::new(state);

    // TODO: In multi-tenant mode, backup and file watcher tasks need to be per-user.
    // For now, these are disabled. Users can trigger manual backups via the API.
    // Future: Start these tasks when a user's garden is loaded, stop when inactive.
    if config.git.enabled && config.git.backup_interval_minutes > 0 {
        warn!(
            "Scheduled backups configured but disabled in multi-tenant mode. \
             Users can trigger manual backups via the API."
        );
    }

    // File watcher is now per-user: started when user's garden is loaded in UserState::new()
    info!("Per-user file watchers enabled (started on garden load)");

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

        // Calculate replenishment period: for N requests/second, replenish every 1000/N ms
        let period_ms = 1000 / rps.get() as u64;

        let governor_config = GovernorConfigBuilder::default()
            .per_millisecond(period_ms)
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
