// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Application state

use std::sync::Arc;

use tend_git::BackupManager;
use tend_search::SearchIndex;
use tend_storage::FileManager;
use tokio::sync::RwLock;
use tracing::info;

use crate::config::Config;
use crate::ws::{EventSender, WsEvent};

/// Shared application state
pub struct AppState {
    pub config: Config,
    pub file_manager: FileManager,
    pub search_index: Arc<RwLock<SearchIndex>>,
    pub backup_manager: BackupManager,
    /// Broadcast channel for WebSocket events
    pub event_sender: EventSender,
}

impl AppState {
    /// Create a new AppState from configuration
    pub async fn new(config: &Config) -> anyhow::Result<Self> {
        // Initialize file manager
        let file_manager = FileManager::new(&config.data_dir)?;

        // Initialize search index
        let index_path = config.data_dir.join(".tend").join("search_index");
        let search_index = SearchIndex::open(&index_path)?;
        let search_index = Arc::new(RwLock::new(search_index));

        // Initialize backup manager
        let backup_manager = BackupManager::new(&config.data_dir, config.git.auto_push);

        // Create event broadcast channel
        let (event_sender, _) = crate::ws::create_event_channel();

        // Index existing pages on startup
        info!("Indexing existing pages...");
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
        info!("Indexing complete");

        Ok(Self {
            config: config.clone(),
            file_manager,
            search_index,
            backup_manager,
            event_sender,
        })
    }

    /// Broadcast an event to all connected WebSocket clients
    pub fn broadcast(&self, event: WsEvent) {
        // Ignore errors (no subscribers is fine)
        let _ = self.event_sender.send(event);
    }
}
