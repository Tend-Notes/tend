// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Configuration management

use std::net::IpAddr;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Server configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// Host to bind to
    #[serde(default = "default_host")]
    pub host: IpAddr,

    /// Port to listen on
    #[serde(default = "default_port")]
    pub port: u16,

    /// Path to the garden data directory
    #[serde(default = "default_data_dir")]
    pub data_dir: PathBuf,

    /// Path to static files (frontend)
    #[serde(default = "default_static_dir")]
    pub static_dir: PathBuf,

    /// Git backup configuration
    #[serde(default)]
    pub git: GitConfig,

    /// CORS configuration
    #[serde(default)]
    pub cors: CorsConfig,

    /// Rate limiting configuration
    #[serde(default)]
    pub rate_limit: RateLimitConfig,

    /// Authentication configuration
    #[serde(default)]
    pub auth: AuthConfig,
}

/// Authentication configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthConfig {
    /// Header name containing the authenticated username (set by reverse proxy)
    /// Default: "Remote-User" (standard Authelia header)
    #[serde(default = "default_user_header")]
    pub user_header: String,

    /// Require authentication. Set to false only for local development.
    /// When false, uses default_user or X-Dev-User header.
    #[serde(default = "default_auth_required")]
    pub required: bool,

    /// Default username when auth is not required (local dev only)
    #[serde(default)]
    pub default_user: Option<String>,

    /// Header to use for simulating users in dev mode (when required=false)
    #[serde(default = "default_dev_user_header")]
    pub dev_user_header: String,

    /// URL to verify authentication (e.g., "http://localhost:9091/api/verify")
    /// Used for WebSocket connections which can't go through reverse proxy auth.
    #[serde(default)]
    pub verify_url: Option<String>,
}

fn default_user_header() -> String {
    std::env::var("TEND_AUTH_HEADER").unwrap_or_else(|_| "Remote-User".to_string())
}

fn default_auth_required() -> bool {
    std::env::var("TEND_AUTH_REQUIRED")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(true)
}

fn default_dev_user_header() -> String {
    "X-Dev-User".to_string()
}

impl Default for AuthConfig {
    fn default() -> Self {
        Self {
            user_header: default_user_header(),
            required: default_auth_required(),
            default_user: std::env::var("TEND_AUTH_DEFAULT_USER").ok(),
            dev_user_header: default_dev_user_header(),
            verify_url: std::env::var("TEND_AUTH_VERIFY_URL").ok(),
        }
    }
}

/// CORS configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorsConfig {
    /// Allowed origins. Empty = same-origin only, ["*"] = allow all, or list specific origins.
    #[serde(default)]
    pub allowed_origins: Vec<String>,
}

impl Default for CorsConfig {
    fn default() -> Self {
        Self {
            // Check env var for development convenience, otherwise same-origin only
            // TEND_CORS_ORIGINS="*" or TEND_CORS_ORIGINS="http://localhost:5173,http://localhost:3000"
            allowed_origins: std::env::var("TEND_CORS_ORIGINS")
                .ok()
                .map(|s| s.split(',').map(|s| s.trim().to_string()).collect())
                .unwrap_or_default(),
        }
    }
}

/// Rate limiting configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitConfig {
    /// Enable rate limiting
    #[serde(default = "default_rate_limit_enabled")]
    pub enabled: bool,

    /// Requests per second (sustained rate)
    #[serde(default = "default_requests_per_second")]
    pub requests_per_second: u32,

    /// Burst capacity (max requests that can be made in a burst)
    #[serde(default = "default_burst_size")]
    pub burst_size: u32,
}

fn default_rate_limit_enabled() -> bool {
    // Check env var, default to true for security
    std::env::var("TEND_RATE_LIMIT_ENABLED")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(true)
}

fn default_requests_per_second() -> u32 {
    std::env::var("TEND_RATE_LIMIT_RPS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(50)
}

fn default_burst_size() -> u32 {
    std::env::var("TEND_RATE_LIMIT_BURST")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(100)
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            enabled: default_rate_limit_enabled(),
            requests_per_second: default_requests_per_second(),
            burst_size: default_burst_size(),
        }
    }
}

/// Git backup configuration
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GitConfig {
    /// Enable git backup
    #[serde(default)]
    pub enabled: bool,

    /// Auto-backup interval in minutes (0 to disable)
    #[serde(default = "default_backup_interval")]
    pub backup_interval_minutes: u32,

    /// Automatically push to remote after backup
    #[serde(default)]
    pub auto_push: bool,
}

fn default_host() -> IpAddr {
    std::env::var("TEND_HOST")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or_else(|| "127.0.0.1".parse().unwrap())
}

fn default_port() -> u16 {
    std::env::var("TEND_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3000)
}

/// Get the base directory for Tend application data (config.toml, gardens.json)
///
/// Resolution order:
/// 1. TEND_BASE_DIR environment variable (explicit override)
/// 2. /var/lib/tend if it exists (system service deployment)
/// 3. XDG data directory (~/.local/share/tend on Linux)
/// 4. ~/.tend fallback
/// 5. ./data (development)
pub fn base_dir() -> PathBuf {
    use directories::ProjectDirs;

    // 1. Explicit environment variable override
    if let Ok(path) = std::env::var("TEND_BASE_DIR") {
        return PathBuf::from(path);
    }

    // 2. Check for system service path (running as tend user or root)
    let system_path = PathBuf::from("/var/lib/tend");
    if system_path.exists() {
        return system_path;
    }

    // 3. XDG data directory for regular users (~/.local/share/tend on Linux)
    if let Some(proj_dirs) = ProjectDirs::from("", "", "tend") {
        let tend_dir = proj_dirs.data_dir().to_path_buf();
        if !tend_dir.exists() {
            let _ = std::fs::create_dir_all(&tend_dir);
        }
        return tend_dir;
    }

    // 4. Fallback to home directory
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home).join(".tend");
    }

    // 5. Last resort: current directory (development)
    PathBuf::from("./data")
}

/// Get the directory where gardens are stored
///
/// If TEND_DATA_DIR is set, gardens live under $TEND_DATA_DIR/Gardens/
/// Otherwise, gardens live under $TEND_BASE_DIR/Gardens/
pub fn gardens_root() -> PathBuf {
    if let Ok(path) = std::env::var("TEND_DATA_DIR") {
        return PathBuf::from(path).join("Gardens");
    }
    base_dir().join("Gardens")
}

/// Get the path for the gardens.json registry file
pub fn gardens_json_path() -> PathBuf {
    base_dir().join("gardens.json")
}

// ========== User-Scoped Path Functions (Multi-Tenant) ==========

/// Get the base directory for a specific user's data
///
/// Returns: $TEND_BASE_DIR/users/$username/
pub fn user_base_dir(username: &str) -> PathBuf {
    base_dir().join("users").join(username)
}

/// Get the directory where a user's gardens are stored
///
/// Returns: $TEND_BASE_DIR/users/$username/Gardens/
pub fn user_gardens_root(username: &str) -> PathBuf {
    user_base_dir(username).join("Gardens")
}

/// Get the path for a user's gardens.json registry file
///
/// Returns: $TEND_BASE_DIR/users/$username/gardens.json
pub fn user_gardens_json_path(username: &str) -> PathBuf {
    user_base_dir(username).join("gardens.json")
}

/// Get the path for a user's preferences file
///
/// Returns: $TEND_BASE_DIR/users/$username/.prefs.json
pub fn user_prefs_path(username: &str) -> PathBuf {
    user_base_dir(username).join(".prefs.json")
}

/// Get the path for a user's UI state file
///
/// Returns: $TEND_BASE_DIR/users/$username/.state.json
pub fn user_state_path(username: &str) -> PathBuf {
    user_base_dir(username).join(".state.json")
}

/// Ensure a user's base directory exists with secure permissions
///
/// Creates the directory with mode 0700 (owner only) on Unix systems.
pub fn ensure_user_dir(username: &str) -> std::io::Result<PathBuf> {
    let user_dir = user_base_dir(username);
    if !user_dir.exists() {
        std::fs::create_dir_all(&user_dir)?;

        // Set restrictive permissions (0700 - owner only)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&user_dir, std::fs::Permissions::from_mode(0o700))?;
        }
    }
    Ok(user_dir)
}

fn default_data_dir() -> PathBuf {
    let gardens_path = gardens_json_path();

    // Check gardens.json for active garden
    if gardens_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&gardens_path) {
            if let Ok(config) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(active_id) = config.get("active").and_then(|v| v.as_str()) {
                    if let Some(gardens) = config.get("gardens").and_then(|v| v.as_array()) {
                        for garden in gardens {
                            if garden.get("id").and_then(|v| v.as_str()) == Some(active_id) {
                                if let Some(path) = garden.get("path").and_then(|v| v.as_str()) {
                                    return PathBuf::from(path);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Default fallback: Notes garden under gardens root
    gardens_root().join("Notes")
}

// Keep old name as alias for backwards compatibility
#[deprecated(note = "Use base_dir() instead")]
pub fn base_data_dir() -> PathBuf {
    base_dir()
}

fn default_static_dir() -> PathBuf {
    std::env::var("TEND_STATIC_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("./static"))
}

fn default_backup_interval() -> u32 {
    30
}

impl Default for Config {
    fn default() -> Self {
        Self {
            host: default_host(),
            port: default_port(),
            data_dir: default_data_dir(),
            static_dir: default_static_dir(),
            git: GitConfig::default(),
            cors: CorsConfig::default(),
            rate_limit: RateLimitConfig::default(),
            auth: AuthConfig::default(),
        }
    }
}

impl Config {
    /// Validate configuration for fatal mismatches.
    ///
    /// Returns an error with an actionable message if the configuration would
    /// leave the server in an insecure or broken state.
    pub fn validate(&self) -> Result<(), String> {
        if self.auth.required && self.auth.verify_url.is_none() {
            return Err(
                "auth.required is true but TEND_AUTH_VERIFY_URL is not set.\n\
                 WebSocket connections cannot be authenticated without a verify URL.\n\
                 Fix: set TEND_AUTH_VERIFY_URL to your reverse proxy's auth verification\n\
                 endpoint (e.g. https://authelia.example.com/api/verify), OR set\n\
                 TEND_AUTH_REQUIRED=false for local development only."
                    .to_string(),
            );
        }

        let is_loopback = self.host.is_loopback();
        let dev_insecure = std::env::var("TEND_DEV_ALLOW_INSECURE")
            .is_ok_and(|v| v == "true");
        if !self.auth.required && !is_loopback && !dev_insecure {
            return Err(
                "Refusing to start: TEND_AUTH_REQUIRED=false with a non-loopback bind address\n\
                 is unsafe — any host that can reach this port has unauthenticated access.\n\
                 Options:\n\
                   1. Set TEND_AUTH_REQUIRED=true and configure a reverse proxy with\n\
                      TEND_AUTH_VERIFY_URL pointing to its auth endpoint.\n\
                   2. Change TEND_HOST to 127.0.0.1 (loopback) if running locally.\n\
                   3. Set TEND_DEV_ALLOW_INSECURE=true to override this check for\n\
                      LAN development only — never use this in production."
                    .to_string(),
            );
        }

        Ok(())
    }

    /// Load configuration from file and environment
    pub fn load() -> anyhow::Result<Self> {
        // Try to load from config file in base directory
        let config_path = std::env::var("TEND_CONFIG")
            .map(PathBuf::from)
            .unwrap_or_else(|_| base_dir().join("config.toml"));

        let config = if config_path.exists() {
            let content = std::fs::read_to_string(&config_path)?;
            toml::from_str(&content)?
        } else {
            Config::default()
        };

        Ok(config)
    }

    /// Save configuration to file with restrictive permissions
    pub fn save(&self) -> anyhow::Result<()> {
        let base = base_dir();
        std::fs::create_dir_all(&base)?;

        let config_path = base.join("config.toml");
        let content = toml::to_string_pretty(self)?;
        std::fs::write(&config_path, content)?;

        // Set restrictive permissions (0600 - owner read/write only)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let permissions = std::fs::Permissions::from_mode(0o600);
            std::fs::set_permissions(&config_path, permissions)?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_config() -> Config {
        Config {
            host: "127.0.0.1".parse().unwrap(),
            port: 3000,
            data_dir: std::path::PathBuf::from("./data"),
            static_dir: std::path::PathBuf::from("./static"),
            git: GitConfig::default(),
            cors: CorsConfig::default(),
            rate_limit: RateLimitConfig::default(),
            auth: AuthConfig {
                user_header: "Remote-User".to_string(),
                required: false,
                default_user: None,
                dev_user_header: "X-Dev-User".to_string(),
                verify_url: None,
            },
        }
    }

    #[test]
    fn validate_rejects_required_auth_without_verify_url() {
        let mut config = base_config();
        config.auth.required = true;
        config.auth.verify_url = None;
        let result = config.validate();
        assert!(result.is_err(), "expected error when auth.required=true and verify_url=None");
        let msg = result.unwrap_err();
        assert!(msg.contains("TEND_AUTH_VERIFY_URL"), "error should mention TEND_AUTH_VERIFY_URL");
    }

    #[test]
    fn validate_accepts_required_auth_with_verify_url() {
        let mut config = base_config();
        config.auth.required = true;
        config.auth.verify_url = Some("http://localhost:9091/api/verify".to_string());
        assert!(config.validate().is_ok());
    }

    #[test]
    fn validate_accepts_auth_not_required_without_verify_url() {
        let mut config = base_config();
        config.auth.required = false;
        config.auth.verify_url = None;
        assert!(config.validate().is_ok());
    }

    #[test]
    fn validate_accepts_auth_disabled_on_loopback() {
        let mut config = base_config();
        config.host = "127.0.0.1".parse().unwrap();
        config.auth.required = false;
        assert!(config.validate().is_ok());
    }

    #[test]
    fn validate_rejects_auth_disabled_on_nonloopback() {
        let mut config = base_config();
        config.host = "0.0.0.0".parse().unwrap();
        config.auth.required = false;
        std::env::remove_var("TEND_DEV_ALLOW_INSECURE");
        let result = config.validate();
        assert!(result.is_err(), "expected error when auth disabled on 0.0.0.0");
        let msg = result.unwrap_err();
        assert!(
            msg.contains("TEND_DEV_ALLOW_INSECURE"),
            "error should mention TEND_DEV_ALLOW_INSECURE"
        );
    }

    #[test]
    fn validate_accepts_auth_disabled_nonloopback_with_dev_insecure() {
        let mut config = base_config();
        config.host = "0.0.0.0".parse().unwrap();
        config.auth.required = false;
        std::env::set_var("TEND_DEV_ALLOW_INSECURE", "true");
        let result = config.validate();
        std::env::remove_var("TEND_DEV_ALLOW_INSECURE");
        assert!(result.is_ok());
    }

    #[test]
    fn validate_accepts_auth_required_on_nonloopback_with_verify_url() {
        let mut config = base_config();
        config.host = "0.0.0.0".parse().unwrap();
        config.auth.required = true;
        config.auth.verify_url = Some("http://localhost:9091/api/verify".to_string());
        assert!(config.validate().is_ok());
    }
}
