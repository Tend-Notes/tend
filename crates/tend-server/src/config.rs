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

/// Get the base directory for all Tend data (gardens.json lives here)
pub fn base_data_dir() -> PathBuf {
    use directories::ProjectDirs;

    // 1. Explicit environment variable override
    if let Ok(path) = std::env::var("TEND_BASE_DIR") {
        return PathBuf::from(path);
    }

    // 2. Check for system service path (running as tend user or root)
    // NixOS/systemd uses StateDirectory=tend which creates /var/lib/tend
    let system_path = PathBuf::from("/var/lib/tend");
    if system_path.exists() {
        return system_path;
    }

    // 3. XDG data directory for regular users (~/.local/share/tend on Linux)
    if let Some(proj_dirs) = ProjectDirs::from("", "", "tend") {
        let tend_dir = proj_dirs.data_dir().to_path_buf();
        // Create if it doesn't exist
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

fn default_data_dir() -> PathBuf {
    // First check environment variable for specific garden path
    if let Ok(path) = std::env::var("TEND_DATA_DIR") {
        return PathBuf::from(path);
    }

    let base_dir = base_data_dir();

    // Then check gardens.json for active garden
    let gardens_path = base_dir.join("gardens.json");
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

    // Default fallback: Notes garden in base directory
    base_dir.join("Notes")
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
        }
    }
}

impl Config {
    /// Load configuration from file and environment
    pub fn load() -> anyhow::Result<Self> {
        // Try to load from config file
        let config_path = std::env::var("TEND_CONFIG")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                let data_dir = default_data_dir();
                data_dir.join(".tend").join("config.toml")
            });

        let config = if config_path.exists() {
            let content = std::fs::read_to_string(&config_path)?;
            toml::from_str(&content)?
        } else {
            Config::default()
        };

        Ok(config)
    }

    /// Save configuration to file
    pub fn save(&self) -> anyhow::Result<()> {
        let config_dir = self.data_dir.join(".tend");
        std::fs::create_dir_all(&config_dir)?;

        let config_path = config_dir.join("config.toml");
        let content = toml::to_string_pretty(self)?;
        std::fs::write(config_path, content)?;

        Ok(())
    }
}
