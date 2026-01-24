// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Application state

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use chrono::NaiveDate;
use tend_core::{ContentType, Page, PageMeta};
use tend_git::BackupManager;
use tend_search::{index_exists, SearchIndex};
use tend_storage::{EncryptedFileManager, FileManager, StorageError};
use tokio::sync::RwLock;
use tracing::info;

use crate::config::{gardens_json_path, Config, GitConfig};
use crate::ws::{EventSender, WsEvent};

/// Status of the search index
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IndexStatus {
    /// Search is disabled for this garden
    Disabled,
    /// Index exists and is ready for searches
    Ready,
    /// Index is being built in the background
    Building,
    /// No index exists (needs to be built)
    NotBuilt,
    /// Index was deleted due to TTL expiry (encrypted gardens)
    Expired,
}

/// Search configuration for a garden
#[derive(Debug, Clone)]
pub struct SearchConfig {
    /// Whether search is enabled
    pub enabled: bool,
    /// Hours after last use before index is auto-deleted (0 = never)
    pub ttl_hours: u32,
}

impl Default for SearchConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            ttl_hours: 0,
        }
    }
}

/// Garden info returned from config lookup
struct GardenInfo {
    path: String,
    encrypted: bool,
    search_config: SearchConfig,
}

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

    /// Acquire exclusive lock for backup
    pub async fn acquire_exclusive_lock(&self) -> tokio::sync::RwLockWriteGuard<'_, ()> {
        match self {
            Self::Plain(fm) => fm.acquire_exclusive_lock().await,
            Self::Encrypted(efm) => efm.acquire_exclusive_lock().await,
        }
    }

    // ========== Sheet (Content Type) Operations ==========

    /// List all sheets of a content type
    pub async fn list_sheets(&self, content_type: &ContentType) -> Result<Vec<PageMeta>, StorageError> {
        match self {
            Self::Plain(fm) => fm.list_sheets(content_type).await,
            Self::Encrypted(efm) => efm.list_sheets(content_type).await,
        }
    }

    /// Read a sheet by content type, name, and optional date
    pub async fn read_sheet(&self, content_type: &ContentType, name: &str, date: Option<NaiveDate>) -> Result<Page, StorageError> {
        match self {
            Self::Plain(fm) => fm.read_sheet(content_type, name, date).await,
            Self::Encrypted(efm) => efm.read_sheet(content_type, name, date).await,
        }
    }

    /// Write a sheet for a content type
    pub async fn write_sheet(&self, content_type: &ContentType, page: &Page, date: Option<NaiveDate>) -> Result<(), StorageError> {
        match self {
            Self::Plain(fm) => fm.write_sheet(content_type, page, date).await,
            Self::Encrypted(efm) => efm.write_sheet(content_type, page, date).await,
        }
    }

    /// Delete a sheet
    pub async fn delete_sheet(&self, content_type: &ContentType, name: &str, date: Option<NaiveDate>) -> Result<(), StorageError> {
        match self {
            Self::Plain(fm) => fm.delete_sheet(content_type, name, date).await,
            Self::Encrypted(efm) => efm.delete_sheet(content_type, name, date).await,
        }
    }

    /// Check if a sheet exists
    pub async fn sheet_exists(&self, content_type: &ContentType, name: &str, date: Option<NaiveDate>) -> bool {
        match self {
            Self::Plain(fm) => fm.sheet_exists(content_type, name, date).await,
            Self::Encrypted(efm) => efm.sheet_exists(content_type, name, date).await,
        }
    }
}

/// Garden-specific state that can be hot-swapped
pub struct GardenState {
    pub data_dir: PathBuf,
    pub file_manager: UnifiedFileManager,
    /// Search index - None if search is disabled or not yet built
    pub search_index: Option<Arc<RwLock<SearchIndex>>>,
    pub backup_manager: BackupManager,
    /// Whether this garden is encrypted
    pub encrypted: bool,
    /// Search configuration
    pub search_config: SearchConfig,
    /// Current status of the search index
    pub index_status: Arc<RwLock<IndexStatus>>,
    /// Last time the search index was used (for TTL tracking)
    pub last_search_use: Arc<RwLock<Option<Instant>>>,
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
            SearchConfig::default(), // Search always enabled for unencrypted
        )
        .await
    }

    /// Create garden state for an encrypted garden
    pub async fn new_encrypted(
        data_dir: PathBuf,
        passphrase: String,
        git_config: &GitConfig,
        search_config: SearchConfig,
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
            search_config,
        )
        .await
    }

    /// Internal constructor with unified file manager
    async fn new_with_file_manager(
        data_dir: PathBuf,
        file_manager: UnifiedFileManager,
        git_config: &GitConfig,
        encrypted: bool,
        search_config: SearchConfig,
    ) -> anyhow::Result<Self> {
        // Initialize backup manager
        let backup_manager = BackupManager::new(&data_dir, git_config.auto_push);

        // Determine initial index status and open existing index if available
        let index_path = data_dir.join(".tend").join("search_index");
        let (search_index, index_status) = if !search_config.enabled {
            info!(
                "Search disabled for {} garden: {}",
                if encrypted { "encrypted" } else { "plain" },
                data_dir.display()
            );
            (None, IndexStatus::Disabled)
        } else if index_exists(&index_path) {
            // Existing index found - open it without re-indexing
            info!(
                "Opening existing search index for {} garden: {}",
                if encrypted { "encrypted" } else { "plain" },
                data_dir.display()
            );
            match SearchIndex::open(&index_path) {
                Ok(index) => {
                    let num_docs = index.num_docs();
                    info!("Search index ready with {} documents", num_docs);
                    (Some(Arc::new(RwLock::new(index))), IndexStatus::Ready)
                }
                Err(e) => {
                    tracing::warn!("Failed to open existing index, will need rebuild: {}", e);
                    (None, IndexStatus::NotBuilt)
                }
            }
        } else {
            // No index exists
            info!(
                "No search index found for {} garden: {}",
                if encrypted { "encrypted" } else { "plain" },
                data_dir.display()
            );
            (None, IndexStatus::NotBuilt)
        };

        Ok(Self {
            data_dir,
            file_manager,
            search_index,
            backup_manager,
            encrypted,
            search_config,
            index_status: Arc::new(RwLock::new(index_status)),
            last_search_use: Arc::new(RwLock::new(None)),
        })
    }

    /// Check if the search index has expired based on TTL
    pub async fn is_index_expired(&self) -> bool {
        if self.search_config.ttl_hours == 0 {
            return false; // No TTL, never expires
        }

        let last_use = self.last_search_use.read().await;
        match *last_use {
            Some(instant) => {
                let elapsed = instant.elapsed();
                elapsed.as_secs() > (self.search_config.ttl_hours as u64 * 3600)
            }
            None => false, // Never used, don't expire immediately
        }
    }

    /// Mark the search index as used (resets TTL timer)
    pub async fn touch_search_index(&self) {
        let mut last_use = self.last_search_use.write().await;
        *last_use = Some(Instant::now());
    }

    /// Delete the search index (for TTL expiry)
    pub async fn delete_search_index(&self) -> anyhow::Result<()> {
        let index_path = self.data_dir.join(".tend").join("search_index");
        if index_path.exists() {
            tokio::fs::remove_dir_all(&index_path).await?;
            info!("Deleted expired search index: {}", index_path.display());
        }
        // Update status
        let mut status = self.index_status.write().await;
        *status = IndexStatus::Expired;
        Ok(())
    }

    /// Get current index status
    pub async fn get_index_status(&self) -> IndexStatus {
        *self.index_status.read().await
    }

    /// Build the search index (full re-index)
    /// This should typically be called from a background task
    pub async fn build_index(&mut self) -> anyhow::Result<()> {
        if !self.search_config.enabled {
            return Err(anyhow::anyhow!("Search is disabled for this garden"));
        }

        // Update status to building
        {
            let mut status = self.index_status.write().await;
            *status = IndexStatus::Building;
        }

        let index_path = self.data_dir.join(".tend").join("search_index");

        info!(
            "Building search index for {} garden: {}",
            if self.encrypted { "encrypted" } else { "plain" },
            self.data_dir.display()
        );

        // Create new index
        let search_index = SearchIndex::open(&index_path)?;
        let search_index = Arc::new(RwLock::new(search_index));

        // Index all pages
        {
            let mut index = search_index.write().await;

            // Index pages
            let pages = self.file_manager.list_pages().await?;
            for page_meta in pages {
                if let Ok(page) = self.file_manager.read_page(&page_meta.name).await {
                    if let Err(e) = index.index_page(&page) {
                        tracing::warn!("Failed to index page {}: {}", page_meta.name, e);
                    }
                }
            }

            // Index journals
            let journals = self.file_manager.list_journals().await?;
            for journal_meta in journals {
                if let Some(date) = journal_meta.journal_date {
                    if let Ok(page) = self.file_manager.read_journal(date).await {
                        if let Err(e) = index.index_page(&page) {
                            tracing::warn!("Failed to index journal {}: {}", journal_meta.name, e);
                        }
                    }
                }
            }

            index.commit()?;
            info!("Search index built with {} documents", index.num_docs());
        }

        // Update state
        self.search_index = Some(search_index);
        {
            let mut status = self.index_status.write().await;
            *status = IndexStatus::Ready;
        }

        Ok(())
    }
}

/// Maximum number of concurrent WebSocket connections
pub const MAX_WS_CONNECTIONS: usize = 100;

/// Shared application state
pub struct AppState {
    pub config: Config,
    /// Garden-specific state wrapped in RwLock for hot-swapping
    pub garden: RwLock<GardenState>,
    /// Broadcast channel for WebSocket events
    pub event_sender: EventSender,
    /// Current WebSocket connection count
    pub ws_connection_count: std::sync::atomic::AtomicUsize,
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
            ws_connection_count: std::sync::atomic::AtomicUsize::new(0),
        })
    }

    /// Switch to a different garden by ID.
    /// For encrypted gardens, returns an error indicating unlock is required.
    pub async fn switch_garden(&self, garden_id: &str) -> anyhow::Result<PathBuf> {
        let info = self.get_garden_info(garden_id)?;
        let new_data_dir = PathBuf::from(&info.path);

        if info.encrypted {
            return Err(anyhow::anyhow!("UNLOCK_REQUIRED:{}", garden_id));
        }

        info!(
            "Switching to garden: {} at {}",
            garden_id,
            new_data_dir.display()
        );

        // Create new garden state first (this is for a different directory, so locks shouldn't conflict)
        let new_garden = GardenState::new(new_data_dir.clone(), &self.config.git).await?;

        // Swap the garden state - the old one is dropped when replaced
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
        let info = self.get_garden_info(garden_id)?;

        if !info.encrypted {
            return Err(anyhow::anyhow!("Garden '{}' is not encrypted", garden_id));
        }

        let new_data_dir = PathBuf::from(&info.path);

        info!(
            "Switching to encrypted garden: {} at {}",
            garden_id,
            new_data_dir.display()
        );

        // Create new encrypted garden state (this verifies the passphrase)
        let new_garden = GardenState::new_encrypted(
            new_data_dir.clone(),
            passphrase,
            &self.config.git,
            info.search_config,
        )
        .await?;

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

    /// Get garden info from config
    fn get_garden_info(&self, garden_id: &str) -> anyhow::Result<GardenInfo> {
        let gardens_path = gardens_json_path();
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

        let search_enabled = garden
            .get("search_enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(!encrypted); // Default: enabled for unencrypted, disabled for encrypted

        let ttl_hours = garden
            .get("index_ttl_hours")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32)
            .unwrap_or(if encrypted { 6 } else { 0 });

        Ok(GardenInfo {
            path,
            encrypted,
            search_config: SearchConfig {
                enabled: search_enabled,
                ttl_hours,
            },
        })
    }

    /// Broadcast an event to all connected WebSocket clients
    pub fn broadcast(&self, event: WsEvent) {
        // Ignore errors (no subscribers is fine)
        let _ = self.event_sender.send(event);
    }
}
