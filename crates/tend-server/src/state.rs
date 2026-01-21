// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Application state

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::NaiveDate;
use tend_core::{Page, PageMeta};
use tend_git::BackupManager;
use tend_search::SearchIndex;
use tend_storage::{EncryptedFileManager, FileManager, StorageError};
use tokio::sync::RwLock;
use tracing::info;

use crate::config::{base_data_dir, Config, GitConfig};
use crate::ws::{EventSender, WsEvent};

/// Unified file manager that handles both encrypted and unencrypted gardens
pub enum UnifiedFileManager {
    Plain(FileManager),
    Encrypted(EncryptedFileManager),
}

impl UnifiedFileManager {
    /// Get the root path
    pub fn root(&self) -> &Path {
        match self {
            Self::Plain(fm) => fm.root(),
            Self::Encrypted(efm) => efm.root(),
        }
    }

    /// Check if a path is pending write
    pub async fn is_pending_write(&self, path: &Path) -> bool {
        match self {
            Self::Plain(fm) => fm.is_pending_write(path).await,
            Self::Encrypted(efm) => efm.is_pending_write(path).await,
        }
    }

    /// Get pending writes reference
    pub fn pending_writes(&self) -> Arc<RwLock<HashSet<PathBuf>>> {
        match self {
            Self::Plain(fm) => fm.pending_writes(),
            Self::Encrypted(efm) => efm.pending_writes(),
        }
    }

    /// List all pages
    pub async fn list_pages(&self) -> Result<Vec<PageMeta>, StorageError> {
        match self {
            Self::Plain(fm) => fm.list_pages().await,
            Self::Encrypted(efm) => efm.list_pages().await,
        }
    }

    /// List all journals
    pub async fn list_journals(&self) -> Result<Vec<PageMeta>, StorageError> {
        match self {
            Self::Plain(fm) => fm.list_journals().await,
            Self::Encrypted(efm) => efm.list_journals().await,
        }
    }

    /// Read a page by name
    pub async fn read_page(&self, name: &str) -> Result<Page, StorageError> {
        match self {
            Self::Plain(fm) => fm.read_page(name).await,
            Self::Encrypted(efm) => efm.read_page(name).await,
        }
    }

    /// Read a journal by date
    pub async fn read_journal(&self, date: NaiveDate) -> Result<Page, StorageError> {
        match self {
            Self::Plain(fm) => fm.read_journal(date).await,
            Self::Encrypted(efm) => efm.read_journal(date).await,
        }
    }

    /// Write a page
    pub async fn write_page(&self, page: &Page) -> Result<(), StorageError> {
        match self {
            Self::Plain(fm) => fm.write_page(page).await,
            Self::Encrypted(efm) => efm.write_page(page).await,
        }
    }

    /// Delete a page
    pub async fn delete_page(&self, name: &str) -> Result<(), StorageError> {
        match self {
            Self::Plain(fm) => fm.delete_page(name).await,
            Self::Encrypted(efm) => efm.delete_page(name).await,
        }
    }

    /// Check if a page exists
    pub async fn page_exists(&self, name: &str) -> bool {
        match self {
            Self::Plain(fm) => fm.page_exists(name).await,
            Self::Encrypted(efm) => efm.page_exists(name).await,
        }
    }

    /// Check if a journal exists
    pub async fn journal_exists(&self, date: NaiveDate) -> bool {
        match self {
            Self::Plain(fm) => fm.journal_exists(date).await,
            Self::Encrypted(efm) => efm.journal_exists(date).await,
        }
    }

    /// Acquire exclusive lock for backup
    pub async fn acquire_exclusive_lock(&self) -> tokio::sync::RwLockWriteGuard<'_, ()> {
        match self {
            Self::Plain(fm) => fm.acquire_exclusive_lock().await,
            Self::Encrypted(efm) => efm.acquire_exclusive_lock().await,
        }
    }
}

/// Garden-specific state that can be hot-swapped
pub struct GardenState {
    pub data_dir: PathBuf,
    pub file_manager: UnifiedFileManager,
    pub search_index: Arc<RwLock<SearchIndex>>,
    pub backup_manager: BackupManager,
    /// Whether this garden is encrypted
    pub encrypted: bool,
}

impl GardenState {
    /// Create garden state for an unencrypted garden
    pub async fn new(data_dir: PathBuf, git_config: &GitConfig) -> anyhow::Result<Self> {
        let file_manager = FileManager::new(&data_dir)?;
        Self::new_with_file_manager(
            data_dir,
            UnifiedFileManager::Plain(file_manager),
            git_config,
            false,
        )
        .await
    }

    /// Create garden state for an encrypted garden
    pub async fn new_encrypted(
        data_dir: PathBuf,
        passphrase: String,
        git_config: &GitConfig,
    ) -> anyhow::Result<Self> {
        // Verify passphrase first
        if !EncryptedFileManager::verify_passphrase(&data_dir, &passphrase)? {
            return Err(anyhow::anyhow!("Invalid passphrase for encrypted garden"));
        }

        let file_manager = EncryptedFileManager::new(&data_dir, passphrase)?;
        Self::new_with_file_manager(
            data_dir,
            UnifiedFileManager::Encrypted(file_manager),
            git_config,
            true,
        )
        .await
    }

    /// Internal constructor with unified file manager
    async fn new_with_file_manager(
        data_dir: PathBuf,
        file_manager: UnifiedFileManager,
        git_config: &GitConfig,
        encrypted: bool,
    ) -> anyhow::Result<Self> {
        // Initialize search index
        let index_path = data_dir.join(".tend").join("search_index");
        let search_index = SearchIndex::open(&index_path)?;
        let search_index = Arc::new(RwLock::new(search_index));

        // Initialize backup manager
        let backup_manager = BackupManager::new(&data_dir, git_config.auto_push);

        // Index existing pages
        info!(
            "Indexing pages for {} garden: {}",
            if encrypted { "encrypted" } else { "plain" },
            data_dir.display()
        );
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
            encrypted,
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

    /// Switch to a different garden by ID.
    /// For encrypted gardens, returns an error indicating unlock is required.
    pub async fn switch_garden(&self, garden_id: &str) -> anyhow::Result<PathBuf> {
        let (garden_path, encrypted) = self.get_garden_info(garden_id)?;
        let new_data_dir = PathBuf::from(&garden_path);

        if encrypted {
            return Err(anyhow::anyhow!("UNLOCK_REQUIRED:{}", garden_id));
        }

        info!(
            "Switching to garden: {} at {}",
            garden_id,
            new_data_dir.display()
        );

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

    /// Switch to an encrypted garden with passphrase
    pub async fn switch_garden_encrypted(
        &self,
        garden_id: &str,
        passphrase: String,
    ) -> anyhow::Result<PathBuf> {
        let (garden_path, encrypted) = self.get_garden_info(garden_id)?;

        if !encrypted {
            return Err(anyhow::anyhow!("Garden '{}' is not encrypted", garden_id));
        }

        let new_data_dir = PathBuf::from(&garden_path);

        info!(
            "Switching to encrypted garden: {} at {}",
            garden_id,
            new_data_dir.display()
        );

        // Create new encrypted garden state (this verifies the passphrase)
        let new_garden =
            GardenState::new_encrypted(new_data_dir.clone(), passphrase, &self.config.git).await?;

        // Swap the garden state
        {
            let mut garden = self.garden.write().await;
            *garden = new_garden;
        }

        info!("Encrypted garden switch complete: {}", garden_id);

        // Notify clients that garden changed
        self.broadcast(WsEvent::GardenSwitched {
            garden_id: garden_id.to_string(),
        });

        Ok(new_data_dir)
    }

    /// Get garden path and encryption status from config
    fn get_garden_info(&self, garden_id: &str) -> anyhow::Result<(String, bool)> {
        let gardens_path = base_data_dir().join("gardens.json");
        let content = std::fs::read_to_string(&gardens_path)
            .map_err(|e| anyhow::anyhow!("Failed to read gardens config: {}", e))?;
        let config: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| anyhow::anyhow!("Failed to parse gardens config: {}", e))?;

        let gardens = config
            .get("gardens")
            .and_then(|v| v.as_array())
            .ok_or_else(|| anyhow::anyhow!("No gardens found in config"))?;

        let garden = gardens
            .iter()
            .find(|g| g.get("id").and_then(|v| v.as_str()) == Some(garden_id))
            .ok_or_else(|| anyhow::anyhow!("Garden '{}' not found", garden_id))?;

        let path = garden
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Garden '{}' has no path", garden_id))?
            .to_string();

        let encrypted = garden
            .get("encrypted")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        Ok((path, encrypted))
    }

    /// Broadcast an event to all connected WebSocket clients
    pub fn broadcast(&self, event: WsEvent) {
        // Ignore errors (no subscribers is fine)
        let _ = self.event_sender.send(event);
    }
}
