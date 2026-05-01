// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Tend Server - Web server for the Tend digital garden

use std::net::SocketAddr;
use std::num::NonZeroU32;
use std::sync::Arc;

use axum::extract::DefaultBodyLimit;
use axum::{routing::get, Router};
use tower_governor::governor::GovernorConfigBuilder;
use tower_governor::key_extractor::SmartIpKeyExtractor;
use tower_governor::GovernorLayer;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use tracing::{info, Level};

mod auth;
mod config;
mod error;
mod headers;
mod indices;
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
    if let Err(msg) = config.validate() {
        tracing::error!("Configuration error: {}", msg);
        std::process::exit(1);
    }
    info!("Loaded configuration");
    config.log_security_posture();
    info!(
        "Request body limit: {} bytes ({} MB); upload endpoint retains 500 MB per-route override",
        config.request_body_limit,
        config.request_body_limit / (1024 * 1024)
    );
    info!("Data directory: {}", config.data_dir.display());

    // Initialize application state (multi-tenant - no gardens loaded at startup)
    let state = AppState::new(&config).await?;
    let state = Arc::new(state);

    // Backup scheduler is now per-user: started when user's garden is loaded in get_user_state()
    if config.git.enabled && config.git.backup_interval_minutes > 0 {
        info!(
            "Per-user backup schedulers enabled (interval: {} minutes)",
            config.git.backup_interval_minutes
        );
    }

    // File watcher is now per-user: started when user's garden is loaded in UserState::new()
    info!("Per-user file watchers enabled (started on garden load)");

    // Start search index GC task (cleans up expired indices for encrypted gardens)
    let _gc_handle = state::start_search_index_gc_task(config.data_dir.clone());

    // Build CORS layer based on configuration
    let cors_layer = if config.cors.allowed_origins.is_empty() {
        // No origins configured = same-origin only (most restrictive)
        info!("CORS: same-origin only (no cross-origin requests allowed)");
        CorsLayer::new()
    } else if config.cors.allowed_origins.len() == 1 && config.cors.allowed_origins[0] == "*" {
        // Wildcard allowed only via TEND_DEV_ALLOW_INSECURE=true (validated in Config::validate).
        // Explicitly disable credentials so a wildcard origin cannot be combined with them.
        info!("CORS: permissive (dev-insecure) — all origins, credentials disabled");
        CorsLayer::new()
            .allow_origin(tower_http::cors::Any)
            .allow_methods(tower_http::cors::Any)
            .allow_headers(tower_http::cors::Any)
            .allow_credentials(false)
    } else {
        // Specific origins listed — credentials are safe with an explicit allowlist.
        use axum::http::HeaderValue;
        let origins: Vec<HeaderValue> = config
            .cors
            .allowed_origins
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect();
        info!("CORS: explicit origins: {:?}", config.cors.allowed_origins);
        CorsLayer::new()
            .allow_origin(origins)
            .allow_methods(tower_http::cors::Any)
            .allow_headers(tower_http::cors::Any)
            .allow_credentials(true)
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
            .key_extractor(SmartIpKeyExtractor)
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
    // Apply a global body limit to all API endpoints. Per-route limits (e.g. the 500 MB
    // upload limit) are applied first and override this router-level default.
    let api_router = Router::new()
        .nest(
            "/api/v1",
            routes::api_router()
                .layer(DefaultBodyLimit::max(config.request_body_limit)),
        )
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

    let [sec0, sec1, sec2, sec3, sec4, sec5] = headers::security_headers_layer();
    let app = api_router
        .fallback_service(static_service)
        .layer(sec5)
        .layer(sec4)
        .layer(sec3)
        .layer(sec2)
        .layer(sec1)
        .layer(sec0)
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
