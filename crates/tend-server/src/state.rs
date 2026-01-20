// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Application state

use std::path::PathBuf;
use std::sync::Arc;

use tend_git::BackupManager;
use tend_search::SearchIndex;
use tend_storage::FileManager;
use tokio::sync::RwLock;
use tracing::info;

use crate::config::{base_data_dir, Config, GitConfig};
use crate::ws::{EventSender, WsEvent};

/// Garden-specific state that can be hot-swapped
pub struct GardenState {
    pub data_dir: PathBuf,
    pub file_manager: FileManager,
    pub search_index: Arc<RwLock<SearchIndex>>,
    pub backup_manager: BackupManager,
}

impl GardenState {
    /// Create garden state for a specific data directory
    pub async fn new(data_dir: PathBuf, git_config: &GitConfig) -> anyhow::Result<Self> {
        // Initialize file manager
        let file_manager = FileManager::new(&data_dir)?;

        // Initialize search index
        let index_path = data_dir.join(".tend").join("search_index");
        let search_index = SearchIndex::open(&index_path)?;
        let search_index = Arc::new(RwLock::new(search_index));

        // Initialize backup manager
        let backup_manager = BackupManager::new(&data_dir, git_config.auto_push);

        // Index existing pages
        info!("Indexing pages for garden: {}", data_dir.display());
        {
            let mut index = search_index.write().await;

            // Index pages
            let pages = file_manager.list_pages().await?;
            for page_meta in pages {
                if let Ok(page) = file_manager.read_page(&page_meta.name).await {
                    if let Err(e) = index.index_page(&page) {
                        tracing::warn!("Failed to index page {}: {}", page_meta.name, e);
                    }
                }
            }

            // Index journals
            let journals = file_manager.list_journals().await?;
            for journal_meta in journals {
                if let Some(date) = journal_meta.journal_date {
                    if let Ok(page) = file_manager.read_journal(date).await {
                        if let Err(e) = index.index_page(&page) {
                            tracing::warn!("Failed to index journal {}: {}", journal_meta.name, e);
                        }
                    }
                }
            }

            index.commit()?;
        }
        info!("Indexing complete for garden: {}", data_dir.display());

        Ok(Self {
            data_dir,
            file_manager,
            search_index,
            backup_manager,
        })
    }
}

/// Shared application state
pub struct AppState {
    pub config: Config,
    /// Garden-specific state wrapped in RwLock for hot-swapping
    pub garden: RwLock<GardenState>,
    /// Broadcast channel for WebSocket events
    pub event_sender: EventSender,
}

impl AppState {
    /// Create a new AppState from configuration
    pub async fn new(config: &Config) -> anyhow::Result<Self> {
        // Create event broadcast channel
        let (event_sender, _) = crate::ws::create_event_channel();

        // Initialize garden state
        let garden = GardenState::new(config.data_dir.clone(), &config.git).await?;

        Ok(Self {
            config: config.clone(),
            garden: RwLock::new(garden),
            event_sender,
        })
    }

    /// Switch to a different garden by ID
    pub async fn switch_garden(&self, garden_id: &str) -> anyhow::Result<PathBuf> {
        // Load gardens config to find the path
        let gardens_path = base_data_dir().join("gardens.json");
        let content = std::fs::read_to_string(&gardens_path)
            .map_err(|e| anyhow::anyhow!("Failed to read gardens config: {}", e))?;
        let config: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| anyhow::anyhow!("Failed to parse gardens config: {}", e))?;

        // Find the garden path
        let gardens = config
            .get("gardens")
            .and_then(|v| v.as_array())
            .ok_or_else(|| anyhow::anyhow!("No gardens found in config"))?;

        let garden_path = gardens
            .iter()
            .find(|g| g.get("id").and_then(|v| v.as_str()) == Some(garden_id))
            .and_then(|g| g.get("path").and_then(|v| v.as_str()))
            .ok_or_else(|| anyhow::anyhow!("Garden '{}' not found", garden_id))?;

        let new_data_dir = PathBuf::from(garden_path);

        info!("Switching to garden: {} at {}", garden_id, new_data_dir.display());

        // Create new garden state
        let new_garden = GardenState::new(new_data_dir.clone(), &self.config.git).await?;

        // Swap the garden state
        {
            let mut garden = self.garden.write().await;
            *garden = new_garden;
        }

        info!("Garden switch complete: {}", garden_id);

        // Notify clients that garden changed
        self.broadcast(WsEvent::GardenSwitched {
            garden_id: garden_id.to_string(),
        });

        Ok(new_data_dir)
    }

    /// Broadcast an event to all connected WebSocket clients
    pub fn broadcast(&self, event: WsEvent) {
        // Ignore errors (no subscribers is fine)
        let _ = self.event_sender.send(event);
    }
}
