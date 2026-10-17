// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Application state

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use chrono::NaiveDate;
use tend_blocks::BlockIndex;
use tend_core::{ContentType, Page, PageMeta};
use tend_git::BackupManager;
use tend_links::LinkIndex;
use tend_search::{index_exists, SearchIndex};
use tend_storage::{EncryptedFileManager, FileManager, StorageError};
use tokio::sync::{Mutex, RwLock};
use tracing::{info, warn};

use crate::config::{ensure_user_dir, user_gardens_json_path, user_gardens_root, Config, GitConfig};
use crate::indices::{TagIndex, TodoIndex};
use crate::routes::helpers::is_default_about;
use crate::ws::{BroadcastEvent, EventSender, WsEvent};
use std::time::Duration;
use tend_storage::watcher::SimpleFileWatcher;

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
    /// The garden's id in the user's gardens.json
    id: String,
    path: String,
    encrypted: bool,
    search_config: SearchConfig,
}

/// The active garden is encrypted and has not been unlocked this session, so
/// there is no per-user state to serve requests from.
///
/// A distinct type (rather than a sentinel message) so the HTTP layer can map
/// it to 423 Locked and tell the client *which* garden to ask a passphrase for;
/// see `From<anyhow::Error> for AppError`. The `Display` text is unchanged from
/// when this was a bare `anyhow!` string, so logs still read the same.
#[derive(Debug)]
pub struct GardenLocked {
    pub garden_id: String,
}

impl std::fmt::Display for GardenLocked {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "UNLOCK_REQUIRED:{}", self.garden_id)
    }
}

impl std::error::Error for GardenLocked {}

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

    /// A sheet's file content as text, unparsed (decrypted for encrypted
    /// gardens). For callers that need the raw bytes without a `Page`.
    pub async fn read_sheet_raw(&self, content_type: &ContentType, name: &str, date: Option<NaiveDate>) -> Result<String, StorageError> {
        match self {
            Self::Plain(fm) => fm.read_sheet_raw(content_type, name, date).await,
            Self::Encrypted(efm) => efm.read_sheet_raw(content_type, name, date).await,
        }
    }

    /// List sheets as lightweight `PageMeta` derived from filenames only — no
    /// file reads or decrypts. Only `name` (canonical) and `journal_date` are
    /// meaningful; used to resolve which pages exist / their hashes cheaply.
    pub async fn list_sheet_names(&self, content_type: &ContentType) -> Result<Vec<PageMeta>, StorageError> {
        match self {
            Self::Plain(fm) => fm.list_sheet_names(content_type).await,
            Self::Encrypted(efm) => efm.list_sheet_names(content_type).await,
        }
    }

    /// Load every sheet of a content type as a fully decrypted `Page`, in a
    /// single decrypt pass. For encrypted gardens this decrypts each file once
    /// (vs. `list_sheets` + `read_sheet`, which decrypts it twice); for plain
    /// gardens reads are cheap so it reuses `list_sheets` + `read_sheet`.
    pub async fn load_all_sheets(&self, content_type: &ContentType) -> Result<Vec<Page>, StorageError> {
        match self {
            Self::Encrypted(efm) => efm.load_all_sheets(content_type).await,
            Self::Plain(fm) => {
                let metas = fm.list_sheets(content_type).await?;
                let mut pages = Vec::with_capacity(metas.len());
                for meta in &metas {
                    let (bare, _) = tend_core::split_name(content_type, &meta.name);
                    if let Ok(page) = fm.read_sheet(content_type, bare, meta.journal_date).await {
                        pages.push(page);
                    }
                }
                Ok(pages)
            }
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
    /// Link index for efficient backlink lookups
    pub link_index: Arc<RwLock<LinkIndex>>,
    /// Block index for block reference lookups - None for encrypted gardens.
    ///
    /// PERF-15: this stays a `Mutex` (not `RwLock`) on purpose. `BlockIndex`
    /// wraps a `rusqlite::Connection`, which is `!Sync` — a SQLite connection
    /// cannot be used from multiple threads concurrently even for reads, so
    /// `RwLock<BlockIndex>` would not be `Sync` and couldn't be shared in the
    /// `Arc`. `lookup` takes `&self`, but the connection still serializes, so a
    /// read-write lock would buy nothing. Making `((uuid))` lookups truly
    /// concurrent would require a connection pool (r2d2) or a read-only
    /// in-memory map — deferred as an architectural change.
    pub block_index: Option<Arc<Mutex<BlockIndex>>>,
    /// Tag index for efficient tag lookups
    pub tag_index: Arc<RwLock<TagIndex>>,
    /// Todo index for efficient todo lookups
    pub todo_index: Arc<RwLock<TodoIndex>>,
    /// Whether the tag/todo indices have been built at least once this session.
    /// Tracked explicitly (not via emptiness) so a garden with zero tags/todos
    /// doesn't re-scan on every /tags or /todos request.
    tag_index_built: Arc<AtomicBool>,
    todo_index_built: Arc<AtomicBool>,
    pub backup_manager: BackupManager,
    /// Whether this garden is encrypted
    pub encrypted: bool,
    /// Search configuration
    pub search_config: SearchConfig,
    /// Current status of the search index
    pub index_status: Arc<RwLock<IndexStatus>>,
    /// Last time the search index was used (for TTL tracking)
    pub last_search_use: Arc<RwLock<Option<Instant>>>,
    /// Last time the on-disk `search_last_use` timestamp was written, to
    /// throttle that write to at most once per minute.
    last_search_persist: Arc<RwLock<Option<Instant>>>,
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
        // Constructing the manager unwraps the garden's X25519 identity with the
        // passphrase (scrypt runs once here); a wrong passphrase fails with an
        // "Invalid passphrase" error, so no separate verify step is needed.
        let file_manager = EncryptedFileManager::new(&data_dir, passphrase)?;

        // Eager migration (SEC-25 Part B): re-encrypt any legacy
        // passphrase-scrypt files to the identity so future reads run no scrypt.
        // One-time; a no-op once the garden is migrated.
        if let Err(e) = file_manager.migrate_to_identity().await {
            tracing::warn!("Encrypted garden identity migration incomplete: {}", e);
        }

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

        // Initialize link index. Encrypted gardens use a RAM-only index (no
        // plaintext page/link names on disk); it is populated by rebuilding
        // from the decrypted pages on unlock (see switch_garden_encrypted).
        let link_index_path = data_dir.join(".tend").join("link_index");
        let link_index = if encrypted {
            // Remove any legacy on-disk link index left from before RAM-only.
            if link_index_path.exists() {
                match std::fs::remove_dir_all(&link_index_path) {
                    Ok(()) => info!(
                        "Removed legacy on-disk link index for encrypted garden: {}",
                        data_dir.display()
                    ),
                    Err(e) => tracing::warn!("Failed to remove legacy link index: {}", e),
                }
            }
            LinkIndex::in_memory()
        } else {
            LinkIndex::new(link_index_path)
                .await
                .map_err(|e| anyhow::anyhow!("Failed to initialize link index: {}", e))?
        };
        let link_entries = link_index.len();
        let link_index = Arc::new(RwLock::new(link_index));
        info!(
            "Link index initialized for {} garden: {} ({} entries)",
            if encrypted { "encrypted" } else { "plain" },
            data_dir.display(),
            link_entries
        );

        // Initialize block index (only for unencrypted gardens)
        // Note: We'll populate this after construction if needed
        let (block_index, needs_block_index_rebuild) = if encrypted {
            info!(
                "Block references disabled for encrypted garden: {}",
                data_dir.display()
            );
            (None, false)
        } else {
            match BlockIndex::new(&data_dir) {
                Ok(index) => {
                    let block_count = index.len().unwrap_or(0);
                    let is_empty = index.is_empty().unwrap_or(true);
                    info!(
                        "Block index opened for garden: {} ({} blocks)",
                        data_dir.display(),
                        block_count
                    );
                    (Some(Arc::new(Mutex::new(index))), is_empty)
                }
                Err(e) => {
                    tracing::warn!("Failed to initialize block index: {}", e);
                    (None, false)
                }
            }
        };

        // Initialize tag and todo indices (empty, populated lazily or on rebuild)
        let tag_index = Arc::new(RwLock::new(TagIndex::new()));
        let todo_index = Arc::new(RwLock::new(TodoIndex::new()));

        // Determine initial index status and open existing index if available
        let index_path = data_dir.join(".tend").join("search_index");
        let (search_index, index_status) = if !search_config.enabled {
            info!(
                "Search disabled for {} garden: {}",
                if encrypted { "encrypted" } else { "plain" },
                data_dir.display()
            );
            (None, IndexStatus::Disabled)
        } else if encrypted {
            // Encrypted gardens never keep a plaintext search index on disk.
            // Remove any legacy on-disk index and defer to an in-memory build
            // on first search (see build_index/rebuild_search_index).
            if index_path.exists() {
                match std::fs::remove_dir_all(&index_path) {
                    Ok(()) => info!(
                        "Removed legacy on-disk search index for encrypted garden: {}",
                        data_dir.display()
                    ),
                    Err(e) => tracing::warn!(
                        "Failed to remove legacy on-disk search index: {}",
                        e
                    ),
                }
            }
            info!(
                "Search index will be built in memory for encrypted garden: {}",
                data_dir.display()
            );
            (None, IndexStatus::NotBuilt)
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

        let state = Self {
            data_dir,
            file_manager,
            search_index,
            link_index,
            block_index,
            tag_index,
            todo_index,
            tag_index_built: Arc::new(AtomicBool::new(false)),
            todo_index_built: Arc::new(AtomicBool::new(false)),
            backup_manager,
            encrypted,
            search_config,
            index_status: Arc::new(RwLock::new(index_status)),
            last_search_use: Arc::new(RwLock::new(None)),
            last_search_persist: Arc::new(RwLock::new(None)),
        };

        // If block index exists but is empty, populate it from existing pages
        if needs_block_index_rebuild {
            info!("Populating empty block index from existing pages");
            let builtin_types = tend_core::ContentType::defaults();
            if let Err(e) = state.rebuild_block_index(&builtin_types).await {
                tracing::warn!("Failed to populate block index: {}", e);
            }
        }

        Ok(state)
    }

    /// How long since the search index was last used (built or searched).
    async fn idle_for(&self) -> Option<Duration> {
        self.last_search_use.read().await.map(|t| t.elapsed())
    }

    /// Mark the search index as used (resets TTL timer)
    pub async fn touch_search_index(&self) {
        let now = Instant::now();
        {
            let mut last_use = self.last_search_use.write().await;
            *last_use = Some(now);
        }

        // TTL disabled (ttl_hours == 0, e.g. unencrypted gardens): the GC never
        // expires this index, so the on-disk timestamp is pure waste. Skip it —
        // as-you-type search then does zero index-dir writes.
        if self.search_config.ttl_hours == 0 {
            return;
        }

        // Otherwise throttle the write to ~once/minute so a stream of queries
        // doesn't rewrite the timestamp file on every keystroke.
        {
            let mut last_persist = self.last_search_persist.write().await;
            match *last_persist {
                Some(t) if now.duration_since(t) < Duration::from_secs(60) => return,
                _ => *last_persist = Some(now),
            }
        }

        // Persist to disk for GC task (survives restarts, works without loading state)
        let last_use_path = self.data_dir.join(".tend").join("search_last_use");
        if let Some(parent) = last_use_path.parent() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }
        let timestamp = chrono::Utc::now().timestamp();
        let _ = tokio::fs::write(&last_use_path, timestamp.to_string()).await;
    }

    /// Drop the in-memory search index if its TTL has elapsed.
    ///
    /// Encrypted gardens hold the index in RAM (never on disk), so this is the
    /// only thing that ends the window in which the garden's content is
    /// readable in the clear. The garden itself stays unlocked; the next search
    /// rebuilds the index (see routes::search::search).
    ///
    /// Returns true if an index was dropped.
    pub async fn expire_index_if_idle(&mut self) -> bool {
        let idle_for = self.idle_for().await;
        self.expire_index_if_idle_for(idle_for).await
    }

    /// `expire_index_if_idle` with the idle duration supplied, so the drop can
    /// be exercised without waiting out a real TTL.
    async fn expire_index_if_idle_for(&mut self, idle_for: Option<Duration>) -> bool {
        if self.search_index.is_none() || !index_expired(self.search_config.ttl_hours, idle_for) {
            return false;
        }

        self.search_index = None;
        *self.last_search_use.write().await = None;
        *self.index_status.write().await = IndexStatus::Expired;
        info!(
            "Dropped idle in-memory search index after {}h of non-use: {}",
            self.search_config.ttl_hours,
            self.data_dir.display()
        );
        true
    }

    /// Claim the right to rebuild an expired index: flips `Expired` to
    /// `Building` and returns true, or returns false if the status has moved on
    /// (another request already started a rebuild). Lets the search path kick
    /// off exactly one rebuild without holding a write lock on the garden.
    pub async fn claim_expired_index_rebuild(&self) -> bool {
        let mut status = self.index_status.write().await;
        if *status != IndexStatus::Expired {
            return false;
        }
        *status = IndexStatus::Building;
        true
    }

    /// Get current index status
    pub async fn get_index_status(&self) -> IndexStatus {
        *self.index_status.read().await
    }

    /// Build the search index (full re-index)
    /// This should typically be called from a background task
    pub async fn build_index(&mut self, content_types: &[ContentType]) -> anyhow::Result<()> {
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

        // Create new index. Encrypted gardens use a RAM-only index so no
        // plaintext content is ever written to disk; it lives only while the
        // garden is unlocked and is rebuilt on the next unlock/search.
        let search_index = if self.encrypted {
            SearchIndex::in_memory()?
        } else {
            SearchIndex::open(&index_path)?
        };
        let search_index = Arc::new(RwLock::new(search_index));

        // Index all content types
        {
            let mut index = search_index.write().await;

            for ct in content_types {
                let sheets = self.file_manager.list_sheets(ct).await?;
                for meta in &sheets {
                    if let Some(page) = self.load_sheet_from_meta(ct, meta).await {
                        // Skip an untouched compilation "About" stub (dust jacket).
                        if is_default_about(&page, ct) {
                            continue;
                        }
                        if let Err(e) = index.index_page(&page) {
                            tracing::warn!("Failed to index {} in search: {}", page.name, e);
                        }
                    }
                }
            }

            index.commit()?;
            info!("Search index built with {} documents", index.num_docs());
        }

        // Update state. Start the TTL clock at build time: an index that is
        // never searched still holds the garden's content in the clear.
        self.search_index = Some(search_index);
        *self.last_search_use.write().await = Some(Instant::now());
        {
            let mut status = self.index_status.write().await;
            *status = IndexStatus::Ready;
        }

        Ok(())
    }

    /// Rebuild the search index in place using the existing writer
    ///
    /// Unlike `build_index()` which creates a new `SearchIndex` (and thus a new
    /// `IndexWriter`), this method clears and repopulates the existing index.
    /// This avoids the Tantivy lock conflict that occurs when a writer is already
    /// held by the running server.
    pub async fn rebuild_search_index(&self, content_types: &[ContentType]) -> anyhow::Result<()> {
        let Some(search_index) = &self.search_index else {
            return Ok(());
        };

        {
            let mut status = self.index_status.write().await;
            *status = IndexStatus::Building;
        }

        info!(
            "Rebuilding search index for {} garden: {}",
            if self.encrypted { "encrypted" } else { "plain" },
            self.data_dir.display()
        );

        let mut index = search_index.write().await;

        // Clear all existing documents
        index.clear()?;

        for ct in content_types {
            let sheets = self.file_manager.list_sheets(ct).await?;
            for meta in &sheets {
                if let Some(page) = self.load_sheet_from_meta(ct, meta).await {
                    // Skip an untouched compilation "About" stub (dust jacket).
                    if is_default_about(&page, ct) {
                        continue;
                    }
                    if let Err(e) = index.index_page(&page) {
                        tracing::warn!("Failed to index {} in search: {}", page.name, e);
                    }
                }
            }
        }

        index.commit()?;
        info!("Search index rebuilt");

        drop(index);

        // Update status to ready
        {
            let mut status = self.index_status.write().await;
            *status = IndexStatus::Ready;
        }

        Ok(())
    }

    /// Load a page/sheet from its metadata, regardless of content type.
    /// Centralizes the journal/page/custom branching in one place.
    pub async fn load_sheet_from_meta(
        &self,
        ct: &ContentType,
        meta: &PageMeta,
    ) -> Option<Page> {
        // Decompose the canonical name to the bare sheet name via the shared
        // name authority (handles page/journal/custom uniformly).
        let (bare_name, _) = tend_core::split_name(ct, &meta.name);
        self.file_manager
            .read_sheet(ct, bare_name, meta.journal_date)
            .await
            .ok()
    }

    /// Rebuild the link index from all pages, journals, and custom sheets
    pub async fn rebuild_link_index(&self, content_types: &[ContentType]) -> anyhow::Result<()> {
        info!(
            "Rebuilding link index for {} garden: {}",
            if self.encrypted { "encrypted" } else { "plain" },
            self.data_dir.display()
        );

        let mut pages_iter: Vec<(String, Vec<tend_core::Block>)> = Vec::new();

        for ct in content_types {
            let sheets = self.file_manager.list_sheets(ct).await?;
            for meta in &sheets {
                if let Some(page) = self.load_sheet_from_meta(ct, meta).await {
                    let blocks: Vec<_> = page.blocks.values().cloned().collect();
                    pages_iter.push((page.name, blocks));
                }
            }
        }

        let mut link_index = self.link_index.write().await;
        link_index
            .rebuild_all(pages_iter.into_iter())
            .await
            .map_err(|e| anyhow::anyhow!("Failed to rebuild link index: {}", e))?;

        info!("Link index rebuilt with {} entries", link_index.len());
        Ok(())
    }

    /// Rebuild the block index from all pages, journals, and custom sheets
    pub async fn rebuild_block_index(&self, content_types: &[ContentType]) -> anyhow::Result<()> {
        let Some(block_index) = &self.block_index else {
            return Err(anyhow::anyhow!("Block index not available (encrypted garden)"));
        };

        info!(
            "Rebuilding block index for garden: {}",
            self.data_dir.display()
        );

        let mut all_pages: Vec<Page> = Vec::new();

        for ct in content_types {
            let sheets = self.file_manager.list_sheets(ct).await?;
            for meta in &sheets {
                if let Some(page) = self.load_sheet_from_meta(ct, meta).await {
                    all_pages.push(page);
                }
            }
        }

        let mut index = block_index.lock().await;
        index.rebuild(all_pages.into_iter())?;

        info!("Block index rebuilt with {} blocks", index.len().unwrap_or(0));
        Ok(())
    }

    /// Rebuild the tag index from all pages, journals, and custom sheets
    pub async fn rebuild_tag_index(&self, content_types: &[ContentType]) -> anyhow::Result<()> {
        info!(
            "Rebuilding tag index for {} garden: {}",
            if self.encrypted { "encrypted" } else { "plain" },
            self.data_dir.display()
        );

        let mut tag_index = self.tag_index.write().await;
        tag_index.clear();

        for ct in content_types {
            let sheets = self.file_manager.list_sheets(ct).await?;
            for meta in &sheets {
                if let Some(page) = self.load_sheet_from_meta(ct, meta).await {
                    tag_index.index_page(&page);
                }
            }
        }

        info!("Tag index rebuilt with {} tags", tag_index.len());
        self.tag_index_built.store(true, Ordering::Relaxed);
        Ok(())
    }

    /// Rebuild the todo index from all pages, journals, and sheets
    pub async fn rebuild_todo_index(&self, content_types: &[ContentType]) -> anyhow::Result<()> {
        info!(
            "Rebuilding todo index for {} garden: {}",
            if self.encrypted { "encrypted" } else { "plain" },
            self.data_dir.display()
        );

        let mut todo_index = self.todo_index.write().await;
        todo_index.clear();

        // Index all content types through the unified loader.
        for ct in content_types {
            let sheets = self.file_manager.list_sheets(ct).await?;
            for sheet_meta in &sheets {
                if let Some(page) = self.load_sheet_from_meta(ct, sheet_meta).await {
                    todo_index.index_page(&page, ct, sheet_meta.journal_date);
                }
            }
        }

        info!("Todo index rebuilt with {} tasks", todo_index.len());
        self.todo_index_built.store(true, Ordering::Relaxed);

        Ok(())
    }

    /// Load every sheet a single time (one decrypt pass) and (re)build the
    /// link, tag, todo, and search indices from that shared set.
    ///
    /// For encrypted gardens each file decrypt runs the scrypt KDF (~1s), so
    /// decrypting a page once and feeding every index from it — instead of each
    /// index re-listing and re-decrypting — cuts unlock-time decryptions ~4x.
    /// (SEC-25 Part A. The per-decrypt scrypt cost itself is Part B.)
    pub async fn rebuild_indices_single_pass(
        &mut self,
        content_types: &[ContentType],
    ) -> anyhow::Result<()> {
        // Single decrypt pass over every sheet (load_all_sheets decrypts each
        // file exactly once and returns the page bodies).
        let mut loaded: Vec<(&ContentType, Option<NaiveDate>, Page)> = Vec::new();
        for ct in content_types {
            for page in self.file_manager.load_all_sheets(ct).await? {
                let journal_date = PageMeta::from(&page).journal_date;
                loaded.push((ct, journal_date, page));
            }
        }

        // Link index (backlinks).
        {
            let pages_for_links: Vec<(String, Vec<tend_core::Block>)> = loaded
                .iter()
                .map(|(_, _, p)| (p.name.clone(), p.blocks.values().cloned().collect()))
                .collect();
            let mut link_index = self.link_index.write().await;
            link_index
                .rebuild_all(pages_for_links.into_iter())
                .await
                .map_err(|e| anyhow::anyhow!("Failed to rebuild link index: {}", e))?;
        }

        // Tag index.
        {
            let mut tag_index = self.tag_index.write().await;
            tag_index.clear();
            for (_, _, page) in &loaded {
                tag_index.index_page(page);
            }
        }
        self.tag_index_built.store(true, Ordering::Relaxed);

        // Todo index.
        {
            let mut todo_index = self.todo_index.write().await;
            todo_index.clear();
            for (ct, date, page) in &loaded {
                todo_index.index_page(page, ct, *date);
            }
        }
        self.todo_index_built.store(true, Ordering::Relaxed);

        // Search index (if enabled): a fresh index populated from the shared
        // pages. Encrypted gardens use a RAM-only index; plain gardens on disk.
        if self.search_config.enabled {
            {
                let mut status = self.index_status.write().await;
                *status = IndexStatus::Building;
            }
            let index_path = self.data_dir.join(".tend").join("search_index");
            let search_index = if self.encrypted {
                SearchIndex::in_memory()?
            } else {
                SearchIndex::open(&index_path)?
            };
            let search_index = Arc::new(RwLock::new(search_index));
            {
                let mut index = search_index.write().await;
                for (ct, _, page) in &loaded {
                    // Skip an untouched compilation "About" stub (dust jacket).
                    if is_default_about(page, ct) {
                        continue;
                    }
                    if let Err(e) = index.index_page(page) {
                        tracing::warn!("Failed to index {} in search: {}", page.name, e);
                    }
                }
                index.commit()?;
            }
            self.search_index = Some(search_index);
            *self.last_search_use.write().await = Some(Instant::now());
            {
                let mut status = self.index_status.write().await;
                *status = IndexStatus::Ready;
            }
        }

        info!(
            "Rebuilt link/tag/todo/search indices from a single decrypt pass ({} sheets)",
            loaded.len()
        );
        Ok(())
    }

    /// Check if tag index is populated
    pub async fn is_tag_index_populated(&self) -> bool {
        self.tag_index_built.load(Ordering::Relaxed)
    }

    /// Check if todo index is populated
    pub async fn is_todo_index_populated(&self) -> bool {
        self.todo_index_built.load(Ordering::Relaxed)
    }
}

/// Maximum number of concurrent WebSocket connections (server-wide)
pub const MAX_WS_CONNECTIONS: usize = 100;

/// Maximum number of concurrent WebSocket connections a single user may hold,
/// so one identity can't exhaust every server-wide slot.
pub const MAX_WS_CONNECTIONS_PER_USER: usize = 10;

/// Maximum number of per-user states cached in memory. Bounds the map so a
/// flood of distinct usernames can't grow it without limit; the
/// least-recently-used entry is evicted when a new user exceeds the cap.
pub const MAX_USER_STATES: usize = 1000;

/// Reserve a per-user WebSocket slot, incrementing the count if under `cap`.
/// Returns false (without incrementing) when the user is already at the cap.
fn acquire_ws_slot(map: &mut std::collections::HashMap<String, usize>, user: &str, cap: usize) -> bool {
    let count = map.entry(user.to_string()).or_insert(0);
    if *count >= cap {
        return false;
    }
    *count += 1;
    true
}

/// Release a per-user WebSocket slot, removing the entry when it reaches zero.
fn release_ws_slot(map: &mut std::collections::HashMap<String, usize>, user: &str) {
    if let Some(count) = map.get_mut(user) {
        *count = count.saturating_sub(1);
        if *count == 0 {
            map.remove(user);
        }
    }
}

/// Whether an index whose last use was `last_use` has outlived `ttl_hours`.
///
/// `last_use` is seeded when the index is built (not only when it is searched),
/// so `None` means "no index" rather than "built but never searched" — the
/// latter used to be treated as never-expiring, which made an index nobody
/// searched the longest-lived plaintext copy of an encrypted garden.
fn index_expired(ttl_hours: u32, idle_for: Option<Duration>) -> bool {
    if ttl_hours == 0 {
        return false; // No TTL, never expires
    }
    match idle_for {
        Some(idle) => idle.as_secs() > (ttl_hours as u64 * 3600),
        None => false, // No index resident, nothing to expire
    }
}

/// Pick the least-recently-used key for eviction. A key missing from `access`
/// is treated as the oldest (evicted first).
fn pick_lru_user(
    keys: &[String],
    access: &std::collections::HashMap<String, std::time::Instant>,
    now: std::time::Instant,
) -> Option<String> {
    keys.iter()
        // A missing timestamp sorts oldest: pair (present, instant) so that
        // `false` (missing) orders before any `true`.
        .min_by_key(|k| (access.contains_key(*k), access.get(*k).copied().unwrap_or(now)))
        .cloned()
}

// ========== User State (Per-User Gardens) ==========

/// Per-user state holding their gardens
pub struct UserState {
    /// The username this state belongs to
    pub username: String,
    /// The user's currently active garden
    pub garden: RwLock<GardenState>,
    /// Reference to global config
    config: Config,
    /// Event sender for WebSocket broadcasts
    event_sender: EventSender,
    /// File watcher task handle (aborted on garden switch)
    watcher_handle: RwLock<Option<tokio::task::JoinHandle<()>>>,
    /// Backup scheduler task handle (aborted on garden switch)
    backup_task_handle: RwLock<Option<tokio::task::JoinHandle<()>>>,
}

impl UserState {
    /// Create a new UserState for the given username
    /// This creates the user's directory and loads their default garden
    pub async fn new(username: String, config: &Config, event_sender: EventSender) -> anyhow::Result<Self> {
        // Ensure user directory exists with secure permissions
        ensure_user_dir(&username)?;

        // Load or create the user's gardens.json
        let gardens_path = user_gardens_json_path(&username);
        let (garden_path, garden_info) = if gardens_path.exists() {
            // Load existing config
            Self::load_active_garden(&username)?
        } else {
            // Create default garden for new user
            Self::create_default_garden(&username)?
        };

        // An encrypted garden can't be opened without the passphrase, so there
        // is nothing to build here. The caller gets a locked error, which the
        // HTTP layer turns into 423 so the client can ask for the passphrase;
        // `AppState::unlock_user_garden` then builds the state via
        // `new_unlocked`. Do NOT make this a hard failure: it is reached on
        // every request after a server restart with an encrypted garden active.
        if garden_info.encrypted {
            return Err(anyhow::Error::new(GardenLocked {
                garden_id: garden_info.id,
            }));
        }

        let garden = GardenState::new(garden_path.clone(), &config.git).await?;

        info!("Initialized state for user: {}", username);

        Ok(Self::from_garden(
            username,
            &garden_path,
            garden,
            config,
            event_sender,
        ))
    }

    /// Open an encrypted garden with its passphrase and build the user's state
    /// around it.
    ///
    /// The unlock path for a user who has no state yet - after a server restart
    /// `UserState::new` can't build one (see above), and every route that could
    /// would fail with the same locked error. The passphrase is verified by
    /// `GardenState::new_encrypted`, which unwraps the garden identity with it.
    pub async fn new_unlocked(
        username: String,
        config: &Config,
        event_sender: EventSender,
        garden_id: &str,
        passphrase: String,
    ) -> anyhow::Result<Self> {
        ensure_user_dir(&username)?;

        let info = Self::garden_info_for(&username, garden_id)?;
        if !info.encrypted {
            return Err(anyhow::anyhow!("Garden '{}' is not encrypted", garden_id));
        }
        let garden_path = PathBuf::from(&info.path);

        let garden = GardenState::new_encrypted(
            garden_path.clone(),
            passphrase,
            &config.git,
            info.search_config,
        )
        .await?;

        info!(
            "Initialized state for user {} with unlocked garden: {}",
            username, garden_id
        );

        let state = Self::from_garden(username, &garden_path, garden, config, event_sender);

        // Same post-unlock index build as a switch into an unlocked garden.
        state.rebuild_after_unlock().await;

        Ok(state)
    }

    /// Assemble a `UserState` around an already-opened garden, starting its
    /// file watcher. Shared by `new` and `new_unlocked`.
    fn from_garden(
        username: String,
        garden_path: &Path,
        garden: GardenState,
        config: &Config,
        event_sender: EventSender,
    ) -> Self {
        let watcher_handle = Self::start_file_watcher(
            &username,
            garden_path,
            &garden.file_manager,
            event_sender.clone(),
        );

        Self {
            username,
            garden: RwLock::new(garden),
            config: config.clone(),
            event_sender,
            watcher_handle: RwLock::new(watcher_handle),
            // Backup task requires Arc<Self>, started by start_backup_task() after Arc wrapping
            backup_task_handle: RwLock::new(None),
        }
    }

    /// Start a file watcher for the given garden path
    fn start_file_watcher(
        username: &str,
        garden_path: &Path,
        file_manager: &UnifiedFileManager,
        event_sender: EventSender,
    ) -> Option<tokio::task::JoinHandle<()>> {
        let pending_writes = file_manager.pending_writes();

        match SimpleFileWatcher::new(garden_path, pending_writes) {
            Ok(watcher) => {
                let mut rx = watcher.subscribe();
                let username_for_log = username.to_string();
                let username_for_task = username_for_log.clone();
                let sender = event_sender;

                let handle = tokio::spawn(async move {
                    let username = username_for_task;
                    // Keep watcher alive by holding reference
                    let _watcher = watcher;

                    while let Ok(file_event) = rx.recv().await {
                        // Convert file event to WsEvent
                        let path_str = match &file_event {
                            tend_storage::watcher::FileEvent::Created(p)
                            | tend_storage::watcher::FileEvent::Modified(p)
                            | tend_storage::watcher::FileEvent::Deleted(p) => {
                                p.to_string_lossy().to_string()
                            }
                            tend_storage::watcher::FileEvent::Renamed { to, .. } => {
                                to.to_string_lossy().to_string()
                            }
                        };

                        // Broadcast to this user only
                        let _ = sender.send(BroadcastEvent {
                            username: Some(username.clone()),
                            event: WsEvent::FileChanged { path: path_str },
                        });
                    }
                });

                info!("File watcher started for user: {}", username_for_log);
                Some(handle)
            }
            Err(e) => {
                tracing::warn!("Failed to start file watcher: {}", e);
                None
            }
        }
    }

    /// Load the active garden path from user's gardens.json
    fn load_active_garden(username: &str) -> anyhow::Result<(PathBuf, GardenInfo)> {
        let gardens_path = user_gardens_json_path(username);
        let content = std::fs::read_to_string(&gardens_path)
            .map_err(|e| anyhow::anyhow!("Failed to read gardens config: {}", e))?;
        let config: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| anyhow::anyhow!("Failed to parse gardens config: {}", e))?;

        let active_id = config
            .get("active")
            .and_then(|v| v.as_str())
            .unwrap_or("default");

        let gardens = config
            .get("gardens")
            .and_then(|v| v.as_array())
            .ok_or_else(|| anyhow::anyhow!("No gardens found in config"))?;

        let garden = gardens
            .iter()
            .find(|g| g.get("id").and_then(|v| v.as_str()) == Some(active_id))
            .ok_or_else(|| anyhow::anyhow!("Active garden '{}' not found", active_id))?;

        let path = garden
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Garden has no path"))?;

        let encrypted = garden
            .get("encrypted")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let search_enabled = garden
            .get("search_enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(!encrypted);

        let ttl_hours = garden
            .get("index_ttl_hours")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32)
            .unwrap_or(if encrypted { 12 } else { 0 });

        Ok((
            PathBuf::from(path),
            GardenInfo {
                id: active_id.to_string(),
                path: path.to_string(),
                encrypted,
                search_config: SearchConfig {
                    enabled: search_enabled,
                    ttl_hours,
                },
            },
        ))
    }

    /// Create a default garden for a new user
    fn create_default_garden(username: &str) -> anyhow::Result<(PathBuf, GardenInfo)> {
        let gardens_root = user_gardens_root(username);
        let default_garden_path = gardens_root.join("Notes");

        // Create garden directory
        std::fs::create_dir_all(&default_garden_path)?;

        // Get path string before moving
        let path_string = default_garden_path.to_string_lossy().to_string();

        // Create gardens.json with default garden
        let gardens_json = serde_json::json!({
            "active": "default",
            "gardens": [{
                "id": "default",
                "name": "Notes",
                "path": &path_string,
                "encrypted": false
            }]
        });

        let gardens_path = user_gardens_json_path(username);
        std::fs::write(&gardens_path, serde_json::to_string_pretty(&gardens_json)?)?;

        info!("Created default garden for user: {}", username);

        Ok((
            default_garden_path,
            GardenInfo {
                id: "default".to_string(),
                path: path_string,
                encrypted: false,
                search_config: SearchConfig::default(),
            },
        ))
    }

    /// Get garden info from user's config
    fn get_garden_info(&self, garden_id: &str) -> anyhow::Result<GardenInfo> {
        Self::garden_info_for(&self.username, garden_id)
    }

    /// Read one garden's entry from a user's gardens.json.
    ///
    /// Takes a username rather than `&self` because the unlock path has to read
    /// this *before* any `UserState` exists.
    fn garden_info_for(username: &str, garden_id: &str) -> anyhow::Result<GardenInfo> {
        let gardens_path = user_gardens_json_path(username);
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
            .unwrap_or(!encrypted);

        let ttl_hours = garden
            .get("index_ttl_hours")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32)
            .unwrap_or(if encrypted { 12 } else { 0 });

        Ok(GardenInfo {
            id: garden_id.to_string(),
            path,
            encrypted,
            search_config: SearchConfig {
                enabled: search_enabled,
                ttl_hours,
            },
        })
    }

    /// Switch to a different garden by ID
    pub async fn switch_garden(&self, garden_id: &str) -> anyhow::Result<PathBuf> {
        let info = self.get_garden_info(garden_id)?;
        let new_data_dir = PathBuf::from(&info.path);

        if info.encrypted {
            return Err(anyhow::Error::new(GardenLocked {
                garden_id: garden_id.to_string(),
            }));
        }

        info!(
            "User {} switching to garden: {} at {}",
            self.username,
            garden_id,
            new_data_dir.display()
        );

        let new_garden = GardenState::new(new_data_dir.clone(), &self.config.git).await?;
        self.install_garden(&new_data_dir, new_garden).await;

        info!("User {} garden switch complete: {}", self.username, garden_id);

        Ok(new_data_dir)
    }

    /// Swap in an already-built garden: stop the old file watcher, start one
    /// for the new garden, then replace both under their locks.
    ///
    /// Shared by the plain and encrypted switches, which differ only in how
    /// the `GardenState` was constructed (and the encrypted one's index
    /// rebuild afterwards).
    async fn install_garden(&self, data_dir: &Path, new_garden: GardenState) {
        self.stop_file_watcher().await;

        let new_watcher = Self::start_file_watcher(
            &self.username,
            data_dir,
            &new_garden.file_manager,
            self.event_sender.clone(),
        );

        {
            let mut garden = self.garden.write().await;
            *garden = new_garden;
        }

        {
            let mut handle = self.watcher_handle.write().await;
            *handle = new_watcher;
        }
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
            "User {} switching to encrypted garden: {} at {}",
            self.username,
            garden_id,
            new_data_dir.display()
        );

        let new_garden = GardenState::new_encrypted(
            new_data_dir.clone(),
            passphrase,
            &self.config.git,
            info.search_config,
        )
        .await?;
        self.install_garden(&new_data_dir, new_garden).await;

        self.rebuild_after_unlock().await;

        info!("User {} encrypted garden switch complete: {}", self.username, garden_id);

        Ok(new_data_dir)
    }

    /// Build the RAM-only indices of a just-unlocked encrypted garden.
    ///
    /// Its search and link indices are RAM-only and start empty, so they are
    /// built from the now-decrypted pages on unlock; otherwise search would sit
    /// at "needs to be built" and backlinks would be blank. SEC-25 Part A:
    /// decrypt each page once and feed every index from that single pass
    /// (link/tag/todo/search), instead of one decrypt pass per index — each
    /// decrypt runs the scrypt KDF, so this cuts unlock cost ~4x.
    async fn rebuild_after_unlock(&self) {
        let content_types =
            crate::routes::gardens::load_user_content_types(&self.username).unwrap_or_default();
        let mut garden = self.garden.write().await;
        if let Err(e) = garden.rebuild_indices_single_pass(&content_types).await {
            tracing::warn!("Failed to build indices on unlock: {}", e);
        }
    }

    /// Stop the current file watcher
    async fn stop_file_watcher(&self) {
        let mut handle = self.watcher_handle.write().await;
        if let Some(h) = handle.take() {
            h.abort();
            info!("File watcher stopped for user: {}", self.username);
        }
    }

    /// Start the backup scheduler task. Must be called after UserState is wrapped in Arc.
    pub async fn start_backup_task(self: &Arc<Self>) {
        if !self.config.git.enabled || self.config.git.backup_interval_minutes == 0 {
            info!(
                "Backup scheduler disabled for user {} (git.enabled={}, interval={})",
                self.username, self.config.git.enabled, self.config.git.backup_interval_minutes
            );
            return;
        }

        let weak_self = Arc::downgrade(self);
        let interval = Duration::from_secs(self.config.git.backup_interval_minutes as u64 * 60);
        let username = self.username.clone();
        let event_sender = self.event_sender.clone();

        let handle = tokio::spawn(async move {
            info!(
                "Backup scheduler started for user {} (interval: {} minutes)",
                username,
                interval.as_secs() / 60
            );

            loop {
                tokio::time::sleep(interval).await;

                let Some(user_state) = weak_self.upgrade() else {
                    info!("Backup scheduler stopping: user {} state dropped", username);
                    break;
                };

                // Broadcast backup started
                let _ = event_sender.send(BroadcastEvent {
                    username: Some(username.clone()),
                    event: WsEvent::BackupStarted,
                });

                // Perform backup
                let garden = user_state.garden.read().await;
                let _lock = garden.file_manager.acquire_exclusive_lock().await;

                match garden.backup_manager.backup() {
                    Ok(result) => {
                        let _ = event_sender.send(BroadcastEvent {
                            username: Some(username.clone()),
                            event: WsEvent::BackupCompleted {
                                commit_sha: result.commit_sha,
                                message: result.message,
                            },
                        });
                    }
                    Err(e) => {
                        let _ = event_sender.send(BroadcastEvent {
                            username: Some(username.clone()),
                            event: WsEvent::BackupFailed {
                                error: e.to_string(),
                            },
                        });
                    }
                }
            }
        });

        let mut backup_handle = self.backup_task_handle.write().await;
        *backup_handle = Some(handle);
    }

    /// Stop the current backup scheduler
    async fn stop_backup_task(&self) {
        let mut handle = self.backup_task_handle.write().await;
        if let Some(h) = handle.take() {
            h.abort();
            info!("Backup scheduler stopped for user: {}", self.username);
        }
    }
}

// ========== Application State ==========

/// Shared application state (multi-tenant)
pub struct AppState {
    pub config: Config,
    /// Per-user states, keyed by username
    user_states: RwLock<std::collections::HashMap<String, Arc<UserState>>>,
    /// Broadcast channel for WebSocket events
    pub event_sender: EventSender,
    /// Current WebSocket connection count (server-wide)
    pub ws_connection_count: std::sync::atomic::AtomicUsize,
    /// Active WebSocket connections per user, for the per-user cap.
    ws_user_connections: std::sync::Mutex<std::collections::HashMap<String, usize>>,
    /// Last-access time per user, for LRU eviction of `user_states`.
    user_last_access: std::sync::Mutex<std::collections::HashMap<String, std::time::Instant>>,
}

impl AppState {
    /// Create a new AppState from configuration
    pub async fn new(config: &Config) -> anyhow::Result<Self> {
        // Create event broadcast channel
        let (event_sender, _) = crate::ws::create_event_channel();

        // Log auth configuration
        if config.auth.required {
            info!(
                "Multi-tenant mode: requiring auth header '{}'",
                config.auth.user_header
            );
        } else {
            info!(
                "Development mode: auth not required, default user: {:?}",
                config.auth.default_user
            );
        }

        Ok(Self {
            config: config.clone(),
            user_states: RwLock::new(std::collections::HashMap::new()),
            event_sender,
            ws_connection_count: std::sync::atomic::AtomicUsize::new(0),
            ws_user_connections: std::sync::Mutex::new(std::collections::HashMap::new()),
            user_last_access: std::sync::Mutex::new(std::collections::HashMap::new()),
        })
    }

    /// Try to reserve a WebSocket slot for `username`, honoring the per-user
    /// cap. Returns false if the user already holds the maximum. Release with
    /// [`AppState::release_ws_slot`] when the connection closes.
    pub fn try_acquire_ws_slot(&self, username: &str) -> bool {
        let mut map = self.ws_user_connections.lock().unwrap();
        acquire_ws_slot(&mut map, username, MAX_WS_CONNECTIONS_PER_USER)
    }

    /// Release a previously reserved per-user WebSocket slot.
    pub fn release_ws_slot(&self, username: &str) {
        let mut map = self.ws_user_connections.lock().unwrap();
        release_ws_slot(&mut map, username);
    }

    /// Record that `username` was just accessed (for LRU eviction).
    fn touch_user_access(&self, username: &str) {
        self.user_last_access
            .lock()
            .unwrap()
            .insert(username.to_string(), std::time::Instant::now());
    }

    /// Get or create user state for the given username
    pub async fn get_user_state(&self, username: &str) -> anyhow::Result<Arc<UserState>> {
        // Check cache first (read lock)
        {
            let states = self.user_states.read().await;
            if let Some(state) = states.get(username) {
                self.touch_user_access(username);
                return Ok(Arc::clone(state));
            }
        }

        // Not cached -- take write lock and check again to prevent double-init race
        let mut states = self.user_states.write().await;
        if let Some(state) = states.get(username) {
            self.touch_user_access(username);
            return Ok(Arc::clone(state));
        }

        // Create new user state while holding write lock
        let user_state = UserState::new(
            username.to_string(),
            &self.config,
            self.event_sender.clone(),
        ).await?;

        Ok(self.cache_user_state(&mut states, username, user_state).await)
    }

    /// Unlock an encrypted garden for `username` and make it their active state.
    ///
    /// Two cases, because the user may or may not already have state loaded:
    ///  - state loaded (they were in another garden) — hand it to the existing
    ///    `switch_garden_encrypted`
    ///  - no state (the usual one after a server restart with an encrypted
    ///    garden active, where `UserState::new` can only report "locked") —
    ///    build the state directly around the unlocked garden
    ///
    /// Without the second case the app is wedged: every route, including the
    /// unlock route itself, fails with the same locked error.
    pub async fn unlock_user_garden(
        &self,
        username: &str,
        garden_id: &str,
        passphrase: String,
    ) -> anyhow::Result<()> {
        {
            let states = self.user_states.read().await;
            if let Some(state) = states.get(username) {
                let state = Arc::clone(state);
                drop(states);
                self.touch_user_access(username);
                state.switch_garden_encrypted(garden_id, passphrase).await?;
                return Ok(());
            }
        }

        // Hold the write lock across construction, as get_user_state does, so
        // two unlock attempts can't build two states for the same user.
        let mut states = self.user_states.write().await;
        if let Some(state) = states.get(username) {
            let state = Arc::clone(state);
            drop(states);
            self.touch_user_access(username);
            state.switch_garden_encrypted(garden_id, passphrase).await?;
            return Ok(());
        }

        let user_state = UserState::new_unlocked(
            username.to_string(),
            &self.config,
            self.event_sender.clone(),
            garden_id,
            passphrase,
        )
        .await?;

        self.cache_user_state(&mut states, username, user_state).await;
        Ok(())
    }

    /// Start the backup task for a freshly built state and put it in the cache,
    /// evicting the least-recently-used entry first if the map is at its cap.
    ///
    /// Caller holds the write lock on `user_states` and passes it in.
    async fn cache_user_state(
        &self,
        states: &mut std::collections::HashMap<String, Arc<UserState>>,
        username: &str,
        user_state: UserState,
    ) -> Arc<UserState> {
        // Bound the map: evict the least-recently-used user before inserting a
        // new one so a flood of distinct usernames can't grow it unbounded.
        if states.len() >= MAX_USER_STATES {
            let keys: Vec<String> = states.keys().cloned().collect();
            let evict = {
                let access = self.user_last_access.lock().unwrap();
                pick_lru_user(&keys, &access, std::time::Instant::now())
            };
            if let Some(evict) = evict {
                states.remove(&evict);
                self.user_last_access.lock().unwrap().remove(&evict);
                warn!("user_states cap ({}) reached; evicted LRU user state", MAX_USER_STATES);
            }
        }

        let user_state = Arc::new(user_state);

        // Start backup scheduler (requires Arc for Weak reference)
        user_state.start_backup_task().await;

        states.insert(username.to_string(), Arc::clone(&user_state));
        self.touch_user_access(username);

        user_state
    }

    /// Snapshot of the currently loaded per-user states.
    ///
    /// Clones the Arcs under a read lock and releases it, so callers (the index
    /// GC task) can take per-garden write locks without holding the map.
    pub async fn loaded_user_states(&self) -> Vec<Arc<UserState>> {
        self.user_states.read().await.values().cloned().collect()
    }

    /// Broadcast an event to a specific user's WebSocket connections
    pub fn broadcast_to_user(&self, username: &str, event: WsEvent) {
        let _ = self.event_sender.send(BroadcastEvent {
            username: Some(username.to_string()),
            event,
        });
    }

    /// Broadcast a garden switch event for a specific user
    pub fn broadcast_garden_switched(&self, username: &str, garden_id: &str) {
        self.broadcast_to_user(
            username,
            WsEvent::GardenSwitched {
                garden_id: garden_id.to_string(),
            },
        );
    }
}

// ========== Search Index Garbage Collection ==========

/// Start a background task that periodically expires search indices for
/// encrypted gardens. Runs every hour.
///
/// Two sweeps per pass, because an index can be in two places:
///  - in RAM, for every loaded encrypted garden (the normal case since the
///    RAM-only change) — `expire_idle_memory_indices`
///  - on disk, only as a legacy leftover — `run_search_index_gc`
pub fn start_search_index_gc_task(
    base_dir: PathBuf,
    state: Arc<AppState>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let gc_interval = Duration::from_secs(3600); // Check every hour
        info!("Search index GC task started (interval: 1 hour)");

        loop {
            tokio::time::sleep(gc_interval).await;

            expire_idle_memory_indices(&state).await;

            if let Err(e) = run_search_index_gc(&base_dir).await {
                tracing::warn!("Search index GC error: {}", e);
            }
        }
    })
}

/// Drop the in-memory search index of every loaded garden whose TTL has
/// elapsed. Nothing else does this, so without it an encrypted garden's
/// plaintext index lives for as long as the process does.
pub async fn expire_idle_memory_indices(state: &AppState) {
    for user_state in state.loaded_user_states().await {
        // expire_index_if_idle logs the garden it dropped.
        let _ = user_state.garden.write().await.expire_index_if_idle().await;
    }
}

/// Run one GC pass: scan all users, find expired search indices, delete them
async fn run_search_index_gc(base_dir: &Path) -> anyhow::Result<()> {
    let users_dir = base_dir.join("users");
    if !users_dir.exists() {
        return Ok(());
    }

    let mut entries = tokio::fs::read_dir(&users_dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let username = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };

        if let Err(e) = gc_user_search_indices(&path, &username).await {
            tracing::warn!("GC error for user {}: {}", username, e);
        }
    }

    Ok(())
}

/// GC search indices for a single user
async fn gc_user_search_indices(user_dir: &Path, username: &str) -> anyhow::Result<()> {
    let gardens_json = user_dir.join("gardens.json");
    if !gardens_json.exists() {
        return Ok(());
    }

    let content = tokio::fs::read_to_string(&gardens_json).await?;
    let config: serde_json::Value = serde_json::from_str(&content)?;

    // gardens.json stores `gardens` as an ARRAY of garden objects (Vec<Garden>).
    // (The previous code read it as an object, so the GC loop never ran at all.)
    let Some(gardens) = config.get("gardens").and_then(|g| g.as_array()) else {
        return Ok(());
    };

    for garden_info in gardens {
        let garden_id = garden_info.get("id").and_then(|v| v.as_str()).unwrap_or("");

        // Only check encrypted gardens with search enabled and TTL > 0
        let encrypted = garden_info.get("encrypted").and_then(|v| v.as_bool()).unwrap_or(false);
        let search_enabled = garden_info.get("search_enabled").and_then(|v| v.as_bool()).unwrap_or(false);
        let ttl_hours = garden_info.get("index_ttl_hours").and_then(|v| v.as_u64()).unwrap_or(0);

        if !encrypted || !search_enabled || ttl_hours == 0 {
            continue;
        }

        // Use the garden's real stored path, not a reconstructed Gardens/<id>:
        // the id is a slugified/lowercased name, so on a case-sensitive FS it may
        // not match the actual directory (e.g. Gardens/notes vs Gardens/Notes) and
        // GC would scan the wrong path, so the index would never be expired.
        let Some(garden_path) = garden_info
            .get("path")
            .and_then(|v| v.as_str())
            .map(PathBuf::from)
        else {
            continue;
        };
        let index_path = garden_path.join(".tend").join("search_index");
        let last_use_path = garden_path.join(".tend").join("search_last_use");

        // Skip if no index exists
        if !index_path.exists() {
            continue;
        }

        // Check last use timestamp
        let is_expired = if last_use_path.exists() {
            match tokio::fs::read_to_string(&last_use_path).await {
                Ok(ts_str) => {
                    if let Ok(ts) = ts_str.trim().parse::<i64>() {
                        let now = chrono::Utc::now().timestamp();
                        let age_hours = (now - ts) / 3600;
                        age_hours > ttl_hours as i64
                    } else {
                        false // Can't parse, don't delete
                    }
                }
                Err(_) => false, // Can't read, don't delete
            }
        } else {
            // No last_use file but index exists - could be old index
            // Check index directory mtime as fallback
            match tokio::fs::metadata(&index_path).await {
                Ok(meta) => {
                    if let Ok(modified) = meta.modified() {
                        let age = modified.elapsed().unwrap_or_default();
                        age.as_secs() > ttl_hours * 3600
                    } else {
                        false
                    }
                }
                Err(_) => false,
            }
        };

        if is_expired {
            info!(
                "GC: Deleting expired search index for user {} garden {} (TTL: {} hours)",
                username, garden_id, ttl_hours
            );
            if let Err(e) = tokio::fs::remove_dir_all(&index_path).await {
                tracing::warn!("Failed to delete expired index: {}", e);
            }
            // Also remove the last_use file
            let _ = tokio::fs::remove_file(&last_use_path).await;
        }
    }

    Ok(())
}

#[cfg(test)]
mod resource_cap_tests {
    use super::{acquire_ws_slot, pick_lru_user, release_ws_slot};
    use std::collections::HashMap;
    use std::time::{Duration, Instant};

    #[test]
    fn per_user_ws_slots_are_capped() {
        let mut map = HashMap::new();
        // Cap of 2: the third acquire for the same user is refused.
        assert!(acquire_ws_slot(&mut map, "alice", 2));
        assert!(acquire_ws_slot(&mut map, "alice", 2));
        assert!(!acquire_ws_slot(&mut map, "alice", 2));
        // A different user is unaffected by alice's usage.
        assert!(acquire_ws_slot(&mut map, "bob", 2));
        // Releasing frees a slot back up, and draining removes the entry.
        release_ws_slot(&mut map, "alice");
        assert!(acquire_ws_slot(&mut map, "alice", 2));
        release_ws_slot(&mut map, "bob");
        assert!(!map.contains_key("bob"));
    }

    #[test]
    fn lru_pick_evicts_oldest_access() {
        let now = Instant::now();
        let mut access = HashMap::new();
        access.insert("old".to_string(), now - Duration::from_secs(100));
        access.insert("mid".to_string(), now - Duration::from_secs(50));
        access.insert("new".to_string(), now);
        let keys = vec!["old".to_string(), "mid".to_string(), "new".to_string()];
        assert_eq!(pick_lru_user(&keys, &access, now).as_deref(), Some("old"));
    }

    #[test]
    fn lru_pick_treats_missing_timestamp_as_oldest() {
        let now = Instant::now();
        let mut access = HashMap::new();
        access.insert("known".to_string(), now - Duration::from_secs(10));
        let keys = vec!["known".to_string(), "untracked".to_string()];
        assert_eq!(pick_lru_user(&keys, &access, now).as_deref(), Some("untracked"));
    }
}

#[cfg(test)]
mod gc_tests {
    use super::gc_user_search_indices;
    use std::path::PathBuf;
    use tempfile::TempDir;

    #[tokio::test]
    async fn gc_sweeps_the_users_directory_under_the_base_dir() {
        // Regression: the task was handed config.data_dir (the *active garden*),
        // so `<dir>/users` never existed and the whole disk sweep was dead.
        // This pins the shape the sweep expects: base_dir/users/<name>.
        let temp = TempDir::new().unwrap();
        let base_dir = temp.path().to_path_buf();
        let user_dir = base_dir.join("users").join("testuser");
        let garden_dir = user_dir.join("Gardens").join("Sealed");
        let index_path: PathBuf = garden_dir.join(".tend").join("search_index");
        tokio::fs::create_dir_all(&index_path).await.unwrap();
        tokio::fs::write(index_path.join("meta.json"), "{}").await.unwrap();

        let old = chrono::Utc::now().timestamp() - 100 * 3600;
        tokio::fs::write(garden_dir.join(".tend").join("search_last_use"), old.to_string())
            .await
            .unwrap();

        let gardens_json = serde_json::json!({
            "gardens": [{
                "id": "sealed",
                "path": garden_dir.to_string_lossy(),
                "encrypted": true,
                "search_enabled": true,
                "index_ttl_hours": 1
            }],
            "active": "sealed"
        });
        tokio::fs::write(user_dir.join("gardens.json"), gardens_json.to_string())
            .await
            .unwrap();

        super::run_search_index_gc(&base_dir).await.unwrap();

        assert!(
            !index_path.exists(),
            "an expired on-disk index under base_dir/users must be removed"
        );
    }

    #[tokio::test]
    async fn gc_uses_stored_garden_path_and_array_format() {
        let temp = TempDir::new().unwrap();
        let user_dir = temp.path().join("users").join("testuser");
        // Real garden dir is "Notes" (capital N); the id is the lowercased slug —
        // the old reconstruct-Gardens/<id> code would look at Gardens/notes.
        let garden_dir = user_dir.join("Gardens").join("Notes");
        let index_path: PathBuf = garden_dir.join(".tend").join("search_index");
        tokio::fs::create_dir_all(&index_path).await.unwrap();
        tokio::fs::write(index_path.join("meta.json"), "{}").await.unwrap();

        // last-use stamp well past a 1h TTL.
        let old = chrono::Utc::now().timestamp() - 100 * 3600;
        tokio::fs::write(garden_dir.join(".tend").join("search_last_use"), old.to_string())
            .await
            .unwrap();

        // gardens.json: `gardens` is an ARRAY; path points at the real dir.
        let gardens_json = serde_json::json!({
            "gardens": [{
                "id": "notes",
                "path": garden_dir.to_string_lossy(),
                "encrypted": true,
                "search_enabled": true,
                "index_ttl_hours": 1
            }],
            "active": "notes"
        });
        tokio::fs::write(user_dir.join("gardens.json"), gardens_json.to_string())
            .await
            .unwrap();

        gc_user_search_indices(&user_dir, "testuser").await.unwrap();

        assert!(
            !index_path.exists(),
            "expired search index should have been deleted"
        );
    }
}

#[cfg(test)]
mod index_expiry_tests {
    use super::{
        index_expired, GardenState, IndexStatus, SearchConfig, UnifiedFileManager,
    };
    use crate::config::GitConfig;
    use std::sync::Arc;
    use std::time::Duration;
    use tempfile::TempDir;
    use tend_search::SearchIndex;
    use tend_storage::FileManager;
    use tokio::sync::RwLock;

    const H: u64 = 3600;

    #[test]
    fn ttl_zero_never_expires() {
        assert!(!index_expired(0, Some(Duration::from_secs(10_000 * H))));
    }

    #[test]
    fn expires_only_past_the_ttl() {
        assert!(!index_expired(12, Some(Duration::from_secs(11 * H))));
        assert!(!index_expired(12, Some(Duration::from_secs(12 * H))));
        assert!(index_expired(12, Some(Duration::from_secs(13 * H))));
    }

    #[test]
    fn no_resident_index_is_not_expired() {
        // `last_search_use` is seeded when the index is built, so None means
        // there is no index to drop — not "built but never searched", which
        // used to be treated as never-expiring.
        assert!(!index_expired(12, None));
    }

    async fn garden_with_resident_index(ttl_hours: u32) -> (TempDir, GardenState) {
        let temp = TempDir::new().unwrap();
        let dir = temp.path().to_path_buf();
        let file_manager = FileManager::new(&dir).unwrap();
        let mut garden = GardenState::new_with_file_manager(
            dir,
            UnifiedFileManager::Plain(file_manager),
            &GitConfig::default(),
            false,
            SearchConfig { enabled: true, ttl_hours },
        )
        .await
        .unwrap();

        // Stand in for the RAM index an encrypted garden builds on unlock.
        garden.search_index = Some(Arc::new(RwLock::new(SearchIndex::in_memory().unwrap())));
        *garden.index_status.write().await = IndexStatus::Ready;
        *garden.last_search_use.write().await = Some(std::time::Instant::now());
        (temp, garden)
    }

    #[tokio::test]
    async fn idle_index_is_dropped_and_marked_expired() {
        let (_temp, mut garden) = garden_with_resident_index(12).await;

        assert!(garden.expire_index_if_idle_for(Some(Duration::from_secs(13 * H))).await);
        assert!(garden.search_index.is_none(), "index should have been dropped");
        assert_eq!(garden.get_index_status().await, IndexStatus::Expired);
        assert!(garden.last_search_use.read().await.is_none());

        // Nothing left to drop on a second pass.
        assert!(!garden.expire_index_if_idle_for(Some(Duration::from_secs(99 * H))).await);
    }

    #[tokio::test]
    async fn index_in_use_is_kept() {
        let (_temp, mut garden) = garden_with_resident_index(12).await;

        assert!(!garden.expire_index_if_idle_for(Some(Duration::from_secs(2 * H))).await);
        assert!(garden.search_index.is_some());
        assert_eq!(garden.get_index_status().await, IndexStatus::Ready);
    }

    #[tokio::test]
    async fn ttl_zero_keeps_the_index_for_the_session() {
        let (_temp, mut garden) = garden_with_resident_index(0).await;

        assert!(!garden.expire_index_if_idle_for(Some(Duration::from_secs(10_000 * H))).await);
        assert!(garden.search_index.is_some());
    }

    #[tokio::test]
    async fn expired_rebuild_is_claimed_once() {
        let (_temp, mut garden) = garden_with_resident_index(12).await;
        garden.expire_index_if_idle_for(Some(Duration::from_secs(13 * H))).await;

        // First search after expiry owns the rebuild; concurrent ones don't.
        assert!(garden.claim_expired_index_rebuild().await);
        assert_eq!(garden.get_index_status().await, IndexStatus::Building);
        assert!(!garden.claim_expired_index_rebuild().await);
    }
}
