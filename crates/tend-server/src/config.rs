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

fn default_data_dir() -> PathBuf {
    std::env::var("TEND_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("./data"))
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
