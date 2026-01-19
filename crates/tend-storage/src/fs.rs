// SPDX-License-Identifier: MIT WITH Commons-Clause
//! File system operations for Tend
//!
//! Handles reading/writing Markdown files with atomic operations.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::NaiveDate;
use tend_core::parser::{is_journal_filename, parse_journal_filename, parse_markdown};
use tend_core::serializer::serialize_page;
use tend_core::{Page, PageMeta};
use tokio::sync::RwLock;
use tracing::{debug, info};

use crate::error::StorageError;

/// Manages file operations for the garden
pub struct FileManager {
    /// Root path of the garden
    root: PathBuf,

    /// Lock for write operations (allows concurrent reads, exclusive writes)
    write_lock: Arc<RwLock<()>>,

    /// Set of paths we're currently writing (so watcher can ignore them)
    pending_writes: Arc<RwLock<HashSet<PathBuf>>>,
}

impl FileManager {
    /// Create a new FileManager for the given root directory
    pub fn new(root: impl AsRef<Path>) -> Result<Self, StorageError> {
        let root = root.as_ref().to_path_buf();

        // Ensure directories exist
        std::fs::create_dir_all(root.join("pages"))?;
        std::fs::create_dir_all(root.join("journals"))?;

        info!("Initialized garden at: {}", root.display());

        Ok(Self {
            root,
            write_lock: Arc::new(RwLock::new(())),
            pending_writes: Arc::new(RwLock::new(HashSet::new())),
        })
    }

    /// Get the root path
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Get path to a page file
    pub fn page_path(&self, name: &str) -> PathBuf {
        self.root.join("pages").join(format!("{}.md", name))
    }

    /// Get path to a journal file
    pub fn journal_path(&self, date: NaiveDate) -> PathBuf {
        let filename = date.format("%Y-%m-%d.md").to_string();
        self.root.join("journals").join(filename)
    }

    /// Check if a path is one we're currently writing
    pub async fn is_pending_write(&self, path: &Path) -> bool {
        self.pending_writes.read().await.contains(path)
    }

    /// Get a reference to pending writes for the watcher
    pub fn pending_writes(&self) -> Arc<RwLock<HashSet<PathBuf>>> {
        Arc::clone(&self.pending_writes)
    }

    /// List all pages (non-journal)
    pub async fn list_pages(&self) -> Result<Vec<PageMeta>, StorageError> {
        let pages_dir = self.root.join("pages");
        let mut pages = Vec::new();

        let mut entries = tokio::fs::read_dir(&pages_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "md") {
                if let Some(name) = path.file_stem().and_then(|s| s.to_str()) {
                    match self.read_page(name).await {
                        Ok(page) => pages.push(PageMeta::from(&page)),
                        Err(e) => {
                            debug!("Failed to read page {}: {}", name, e);
                        }
                    }
                }
            }
        }

        // Sort by modified time, newest first
        pages.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));

        Ok(pages)
    }

    /// List all journals
    pub async fn list_journals(&self) -> Result<Vec<PageMeta>, StorageError> {
        let journals_dir = self.root.join("journals");
        let mut journals = Vec::new();

        let mut entries = tokio::fs::read_dir(&journals_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if let Some(filename) = path.file_name().and_then(|s| s.to_str()) {
                if is_journal_filename(filename) {
                    if let Some(date) = parse_journal_filename(filename) {
                        match self.read_journal(date).await {
                            Ok(page) => journals.push(PageMeta::from(&page)),
                            Err(e) => {
                                debug!("Failed to read journal {}: {}", filename, e);
                            }
                        }
                    }
                }
            }
        }

        // Sort by date, newest first
        journals.sort_by(|a, b| b.journal_date.cmp(&a.journal_date));

        Ok(journals)
    }

    /// Read a page by name
    pub async fn read_page(&self, name: &str) -> Result<Page, StorageError> {
        let path = self.page_path(name);

        if !path.exists() {
            return Err(StorageError::NotFound(name.to_string()));
        }

        let content = tokio::fs::read_to_string(&path).await?;
        let mut page = parse_markdown(&content, name)
            .map_err(|e| StorageError::ParseError(e.to_string()))?;

        // Get file metadata for timestamps
        let metadata = tokio::fs::metadata(&path).await?;
        if let Ok(modified) = metadata.modified() {
            page.modified_at = modified.into();
        }
        if let Ok(created) = metadata.created() {
            page.created_at = created.into();
        }

        Ok(page)
    }

    /// Read a journal by date
    pub async fn read_journal(&self, date: NaiveDate) -> Result<Page, StorageError> {
        let path = self.journal_path(date);

        if !path.exists() {
            // Return an empty journal page (not an error)
            return Ok(Page::new_journal(date));
        }

        let content = tokio::fs::read_to_string(&path).await?;
        let name = date.format("%Y-%m-%d").to_string();
        let mut page = parse_markdown(&content, &name)
            .map_err(|e| StorageError::ParseError(e.to_string()))?;

        // Set journal-specific fields
        page.is_journal = true;
        page.journal_date = Some(date);
        page.title = date.format("%A, %B %-d, %Y").to_string();

        // Get file metadata for timestamps
        let metadata = tokio::fs::metadata(&path).await?;
        if let Ok(modified) = metadata.modified() {
            page.modified_at = modified.into();
        }
        if let Ok(created) = metadata.created() {
            page.created_at = created.into();
        }

        Ok(page)
    }

    /// Write a page (atomic operation)
    pub async fn write_page(&self, page: &Page) -> Result<(), StorageError> {
        let path = if page.is_journal {
            self.journal_path(page.journal_date.unwrap_or_else(|| {
                chrono::Local::now().date_naive()
            }))
        } else {
            self.page_path(&page.name)
        };

        self.write_file(&path, page).await
    }

    /// Write a page to a specific path (atomic operation)
    async fn write_file(&self, path: &Path, page: &Page) -> Result<(), StorageError> {
        // Acquire read lock (allows concurrent writes, but backup can get exclusive)
        let _guard = self.write_lock.read().await;

        let content = serialize_page(page);
        let tmp_path = path.with_extension("md.tmp");

        // Mark as pending write
        {
            let mut pending = self.pending_writes.write().await;
            pending.insert(path.to_path_buf());
        }

        // Write to temp file
        tokio::fs::write(&tmp_path, &content).await?;

        // Atomic rename
        tokio::fs::rename(&tmp_path, path).await?;

        // Remove from pending writes after a short delay (for watcher debounce)
        let pending_writes = Arc::clone(&self.pending_writes);
        let path_buf = path.to_path_buf();
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            let mut pending = pending_writes.write().await;
            pending.remove(&path_buf);
        });

        debug!("Wrote page: {}", path.display());

        Ok(())
    }

    /// Delete a page
    pub async fn delete_page(&self, name: &str) -> Result<(), StorageError> {
        let path = self.page_path(name);

        if !path.exists() {
            return Err(StorageError::NotFound(name.to_string()));
        }

        // Acquire read lock
        let _guard = self.write_lock.read().await;

        // Mark as pending write
        {
            let mut pending = self.pending_writes.write().await;
            pending.insert(path.clone());
        }

        tokio::fs::remove_file(&path).await?;

        info!("Deleted page: {}", name);

        Ok(())
    }

    /// Check if a page exists
    pub async fn page_exists(&self, name: &str) -> bool {
        self.page_path(name).exists()
    }

    /// Check if a journal exists
    pub async fn journal_exists(&self, date: NaiveDate) -> bool {
        self.journal_path(date).exists()
    }

    /// Acquire exclusive lock (for git backup)
    pub async fn acquire_exclusive_lock(&self) -> tokio::sync::RwLockWriteGuard<'_, ()> {
        info!("Acquiring exclusive lock for backup");
        self.write_lock.write().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    async fn setup() -> (TempDir, FileManager) {
        let temp_dir = TempDir::new().unwrap();
        let fm = FileManager::new(temp_dir.path()).unwrap();
        (temp_dir, fm)
    }

    #[tokio::test]
    async fn test_create_directories() {
        let (temp_dir, _fm) = setup().await;

        assert!(temp_dir.path().join("pages").exists());
        assert!(temp_dir.path().join("journals").exists());
    }

    #[tokio::test]
    async fn test_write_and_read_page() {
        let (_temp_dir, fm) = setup().await;

        let mut page = Page::new("Test Page");
        let block = tend_core::Block::new("Hello, world!");
        page.add_block(block);

        fm.write_page(&page).await.unwrap();

        let read_page = fm.read_page("Test Page").await.unwrap();
        assert_eq!(read_page.name, "Test Page");
        assert_eq!(read_page.blocks.len(), 1);
    }

    #[tokio::test]
    async fn test_write_and_read_journal() {
        let (_temp_dir, fm) = setup().await;

        let date = NaiveDate::from_ymd_opt(2025, 1, 18).unwrap();
        let mut page = Page::new_journal(date);
        let block = tend_core::Block::new("Today's notes");
        page.add_block(block);

        fm.write_page(&page).await.unwrap();

        let read_page = fm.read_journal(date).await.unwrap();
        assert!(read_page.is_journal);
        assert_eq!(read_page.journal_date, Some(date));
        assert_eq!(read_page.blocks.len(), 1);
    }

    #[tokio::test]
    async fn test_list_pages() {
        let (_temp_dir, fm) = setup().await;

        // Create a few pages
        for name in ["Page A", "Page B", "Page C"] {
            let mut page = Page::new(name);
            page.add_block(tend_core::Block::new("Content"));
            fm.write_page(&page).await.unwrap();
        }

        let pages = fm.list_pages().await.unwrap();
        assert_eq!(pages.len(), 3);
    }

    #[tokio::test]
    async fn test_delete_page() {
        let (_temp_dir, fm) = setup().await;

        let mut page = Page::new("To Delete");
        page.add_block(tend_core::Block::new("Content"));
        fm.write_page(&page).await.unwrap();

        assert!(fm.page_exists("To Delete").await);

        fm.delete_page("To Delete").await.unwrap();

        assert!(!fm.page_exists("To Delete").await);
    }

    #[tokio::test]
    async fn test_read_nonexistent_page() {
        let (_temp_dir, fm) = setup().await;

        let result = fm.read_page("Nonexistent").await;
        assert!(matches!(result, Err(StorageError::NotFound(_))));
    }
}
