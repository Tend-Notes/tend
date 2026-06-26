// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Encrypted file system operations for Tend
//!
//! Wraps FileManager to provide transparent encryption/decryption of markdown files
//! using age encryption.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::NaiveDate;
use tend_core::parser::{is_journal_filename, parse_journal_filename, parse_markdown};
use tend_core::serializer::serialize_page;
use tend_core::{ContentType, Page, PageMeta};
use tokio::sync::RwLock;
use tracing::{debug, info};

use crate::encryption::{decrypt, encrypt, EncryptionError};
use crate::error::StorageError;
use crate::fs::{decode_filename, encode_filename, validate_safe_name};

/// File extension for encrypted files
const ENCRYPTED_EXT: &str = "md.age";

/// Manages encrypted file operations for a garden
pub struct EncryptedFileManager {
    /// Root path of the garden
    root: PathBuf,

    /// Passphrase for encryption/decryption (held in memory)
    passphrase: String,

    /// Lock for write operations
    write_lock: Arc<RwLock<()>>,

    /// Set of paths we're currently writing
    pending_writes: Arc<RwLock<HashSet<PathBuf>>>,
}

impl EncryptedFileManager {
    /// Create a new EncryptedFileManager for an encrypted garden
    pub fn new(root: impl AsRef<Path>, passphrase: String) -> Result<Self, StorageError> {
        let root = root.as_ref().to_path_buf();

        // Ensure directories exist
        std::fs::create_dir_all(root.join("pages"))?;
        std::fs::create_dir_all(root.join("journals"))?;

        info!("Initialized encrypted garden at: {}", root.display());

        Ok(Self {
            root,
            passphrase,
            write_lock: Arc::new(RwLock::new(())),
            pending_writes: Arc::new(RwLock::new(HashSet::new())),
        })
    }

    /// Verify the passphrase is correct by decrypting the verification file
    pub fn verify_passphrase(root: impl AsRef<Path>, passphrase: &str) -> Result<bool, StorageError> {
        let verify_path = root.as_ref().join(".tend").join("encryption.verify");

        if !verify_path.exists() {
            return Err(StorageError::Other(
                "Encryption verification file not found".to_string(),
            ));
        }

        let encrypted = std::fs::read(&verify_path)?;

        match decrypt(&encrypted, passphrase) {
            Ok(content) => {
                if content == "tend-encryption-verification" {
                    Ok(true)
                } else {
                    Ok(false)
                }
            }
            Err(EncryptionError::WrongPassphrase) => Ok(false),
            Err(e) => Err(StorageError::Other(format!(
                "Failed to verify passphrase: {}",
                e
            ))),
        }
    }

    /// Get the root path
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Get path to an encrypted page file
    fn page_path(&self, name: &str) -> PathBuf {
        self.root
            .join("pages")
            .join(format!("{}.{}", encode_filename(name), ENCRYPTED_EXT))
    }

    /// Get path to an encrypted journal file
    fn journal_path(&self, date: NaiveDate) -> PathBuf {
        let filename = date.format(&format!("%Y-%m-%d.{}", ENCRYPTED_EXT)).to_string();
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

    /// List all encrypted pages
    pub async fn list_pages(&self) -> Result<Vec<PageMeta>, StorageError> {
        let pages_dir = self.root.join("pages");
        let mut pages = Vec::new();

        let mut entries = tokio::fs::read_dir(&pages_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();

            // Check for .md.age extension
            if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                if name.ends_with(&format!(".{}", ENCRYPTED_EXT)) {
                    let raw_name = name.strip_suffix(&format!(".{}", ENCRYPTED_EXT)).unwrap();
                    let page_name = decode_filename(raw_name);
                    match self.read_page(&page_name).await {
                        Ok(page) => pages.push(PageMeta::from(&page)),
                        Err(e) => {
                            debug!("Failed to read encrypted page {}: {}", page_name, e);
                        }
                    }
                }
            }
        }

        pages.sort_by_key(|a| std::cmp::Reverse(a.modified_at));
        Ok(pages)
    }

    /// List all encrypted journals
    pub async fn list_journals(&self) -> Result<Vec<PageMeta>, StorageError> {
        let journals_dir = self.root.join("journals");
        let mut journals = Vec::new();

        let mut entries = tokio::fs::read_dir(&journals_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if let Some(filename) = path.file_name().and_then(|s| s.to_str()) {
                // Check for encrypted journal format: YYYY-MM-DD.md.age
                if filename.ends_with(&format!(".{}", ENCRYPTED_EXT)) {
                    let base_name = filename.strip_suffix(".age").unwrap();
                    if is_journal_filename(base_name) {
                        if let Some(date) = parse_journal_filename(base_name) {
                            match self.read_journal(date).await {
                                Ok(page) => journals.push(PageMeta::from(&page)),
                                Err(e) => {
                                    debug!("Failed to read encrypted journal {}: {}", filename, e);
                                }
                            }
                        }
                    }
                }
            }
        }

        journals.sort_by_key(|a| std::cmp::Reverse(a.journal_date));
        Ok(journals)
    }

    /// Read and decrypt a page by name
    pub async fn read_page(&self, name: &str) -> Result<Page, StorageError> {
        validate_safe_name(name)?;
        let path = self.page_path(name);

        // Backwards compat: try encoded path first, fall back to raw path
        let path = if !path.exists() {
            let raw_path = self.root.join("pages").join(format!("{}.{}", name, ENCRYPTED_EXT));
            if raw_path.exists() {
                raw_path
            } else {
                return Err(StorageError::NotFound(name.to_string()));
            }
        } else {
            path
        };

        let encrypted = tokio::fs::read(&path).await?;
        let content = decrypt(&encrypted, &self.passphrase).map_err(|e| match e {
            EncryptionError::WrongPassphrase => {
                StorageError::Other("Wrong passphrase".to_string())
            }
            _ => StorageError::Other(format!("Decryption failed: {}", e)),
        })?;

        let mut page = parse_markdown(&content, name)
            .map_err(|e| StorageError::ParseError(e.to_string()))?;

        // Set content type
        page.content_type = "page".to_string();

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

    /// Read and decrypt a journal by date
    pub async fn read_journal(&self, date: NaiveDate) -> Result<Page, StorageError> {
        let path = self.journal_path(date);

        if !path.exists() {
            // Return an empty journal page (not an error)
            return Ok(Page::new_journal(date));
        }

        let encrypted = tokio::fs::read(&path).await?;
        let content = decrypt(&encrypted, &self.passphrase).map_err(|e| match e {
            EncryptionError::WrongPassphrase => {
                StorageError::Other("Wrong passphrase".to_string())
            }
            _ => StorageError::Other(format!("Decryption failed: {}", e)),
        })?;

        let name = date.format("%Y-%m-%d").to_string();
        let mut page = parse_markdown(&content, &name)
            .map_err(|e| StorageError::ParseError(e.to_string()))?;

        // Set journal-specific fields
        page.content_type = "journal".to_string();
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

    /// Encrypt and write a page
    pub async fn write_page(&self, page: &Page) -> Result<(), StorageError> {
        if !page.is_journal {
            validate_safe_name(&page.name)?;
        }
        let path = if page.is_journal {
            self.journal_path(page.journal_date.unwrap_or_else(|| {
                chrono::Local::now().date_naive()
            }))
        } else {
            self.page_path(&page.name)
        };

        self.write_file(&path, page).await
    }

    /// Encrypt and write a page to a specific path
    async fn write_file(&self, path: &Path, page: &Page) -> Result<(), StorageError> {
        // Acquire read lock
        let _guard = self.write_lock.read().await;

        let content = serialize_page(page);
        let encrypted = encrypt(&content, &self.passphrase)
            .map_err(|e| StorageError::Other(format!("Encryption failed: {}", e)))?;

        let tmp_path = path.with_extension("tmp");

        // Mark as pending write
        {
            let mut pending = self.pending_writes.write().await;
            pending.insert(path.to_path_buf());
        }

        // Write encrypted content to temp file
        tokio::fs::write(&tmp_path, &encrypted).await?;

        // Atomic rename
        tokio::fs::rename(&tmp_path, path).await?;

        // Remove from pending writes after a delay to ensure file watcher
        // events are properly ignored. Using 1000ms for consistency with fs.rs.
        let pending_writes = Arc::clone(&self.pending_writes);
        let path_buf = path.to_path_buf();
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
            let mut pending = pending_writes.write().await;
            pending.remove(&path_buf);
        });

        debug!("Wrote encrypted page: {}", path.display());

        Ok(())
    }

    /// Delete an encrypted page
    pub async fn delete_page(&self, name: &str) -> Result<(), StorageError> {
        validate_safe_name(name)?;
        let path = self.page_path(name);

        // Backwards compat: try encoded path first, fall back to raw path
        let path = if !path.exists() {
            let raw_path = self.root.join("pages").join(format!("{}.{}", name, ENCRYPTED_EXT));
            if raw_path.exists() {
                raw_path
            } else {
                return Err(StorageError::NotFound(name.to_string()));
            }
        } else {
            path
        };

        let _guard = self.write_lock.read().await;

        {
            let mut pending = self.pending_writes.write().await;
            pending.insert(path.clone());
        }

        tokio::fs::remove_file(&path).await?;

        info!("Deleted encrypted page: {}", name);

        Ok(())
    }

    /// Check if an encrypted page exists
    pub async fn page_exists(&self, name: &str) -> bool {
        if validate_safe_name(name).is_err() {
            return false;
        }
        if self.page_path(name).exists() {
            return true;
        }
        // Backwards compat: check raw path
        self.root.join("pages").join(format!("{}.{}", name, ENCRYPTED_EXT)).exists()
    }

    /// Check if an encrypted journal exists
    pub async fn journal_exists(&self, date: NaiveDate) -> bool {
        self.journal_path(date).exists()
    }

    /// Acquire exclusive lock (for git backup)
    pub async fn acquire_exclusive_lock(&self) -> tokio::sync::RwLockWriteGuard<'_, ()> {
        info!("Acquiring exclusive lock for backup");
        self.write_lock.write().await
    }

    // ========== Sheet (Content Type) Operations ==========

    /// Get path to an encrypted sheet file for a content type
    fn sheet_path(&self, content_type: &ContentType, name: &str, date: Option<NaiveDate>) -> PathBuf {
        let dir = self.root.join(&content_type.directory);
        if content_type.is_date_foldered() {
            let d = date.unwrap_or_else(|| chrono::Local::now().date_naive());
            dir.join(d.format("%Y-%m-%d").to_string())
                .join(format!("{}.{}", encode_filename(name), ENCRYPTED_EXT))
        } else {
            dir.join(format!("{}.{}", encode_filename(name), ENCRYPTED_EXT))
        }
    }

    /// Raw (unencoded) sheet path for backwards compatibility
    fn raw_sheet_path(&self, content_type: &ContentType, name: &str, date: Option<NaiveDate>) -> PathBuf {
        let dir = self.root.join(&content_type.directory);
        if content_type.is_date_foldered() {
            let d = date.unwrap_or_else(|| chrono::Local::now().date_naive());
            dir.join(d.format("%Y-%m-%d").to_string())
                .join(format!("{}.{}", name, ENCRYPTED_EXT))
        } else {
            dir.join(format!("{}.{}", name, ENCRYPTED_EXT))
        }
    }

    /// Ensure content type directory exists
    pub async fn ensure_content_type_dir(&self, content_type: &ContentType, date: Option<NaiveDate>) -> Result<(), StorageError> {
        let dir = if content_type.is_date_foldered() {
            let d = date.unwrap_or_else(|| chrono::Local::now().date_naive());
            self.root.join(&content_type.directory).join(d.format("%Y-%m-%d").to_string())
        } else {
            self.root.join(&content_type.directory)
        };
        tokio::fs::create_dir_all(&dir).await?;
        Ok(())
    }

    /// List all encrypted sheets of a content type
    pub async fn list_sheets(&self, content_type: &ContentType) -> Result<Vec<PageMeta>, StorageError> {
        // Handle built-in types by delegating to existing methods
        if content_type.id == "page" {
            return self.list_pages().await;
        }
        if content_type.id == "journal" {
            return self.list_journals().await;
        }

        let base_dir = self.root.join(&content_type.directory);

        if !base_dir.exists() {
            return Ok(Vec::new());
        }

        let mut sheets = Vec::new();
        let ext_suffix = format!(".{}", ENCRYPTED_EXT);

        if content_type.is_date_foldered() {
            let mut date_dirs = tokio::fs::read_dir(&base_dir).await?;
            while let Some(date_entry) = date_dirs.next_entry().await? {
                let date_path = date_entry.path();
                if date_path.is_dir() {
                    let date = date_path
                        .file_name()
                        .and_then(|s| s.to_str())
                        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());

                    let mut entries = tokio::fs::read_dir(&date_path).await?;
                    while let Some(entry) = entries.next_entry().await? {
                        let path = entry.path();
                        if let Some(filename) = path.file_name().and_then(|s| s.to_str()) {
                            if filename.ends_with(&ext_suffix) {
                                let raw_name = filename.strip_suffix(&ext_suffix).unwrap();
                                let name = decode_filename(raw_name);
                                match self.read_sheet(content_type, &name, date).await {
                                    Ok(page) => sheets.push(PageMeta::from(&page)),
                                    Err(e) => {
                                        debug!("Failed to read encrypted sheet {}/{}: {}", content_type.id, name, e);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } else {
            let mut entries = tokio::fs::read_dir(&base_dir).await?;
            while let Some(entry) = entries.next_entry().await? {
                let path = entry.path();
                if let Some(filename) = path.file_name().and_then(|s| s.to_str()) {
                    if filename.ends_with(&ext_suffix) {
                        let raw_name = filename.strip_suffix(&ext_suffix).unwrap();
                        let name = decode_filename(raw_name);
                        match self.read_sheet(content_type, &name, None).await {
                            Ok(page) => sheets.push(PageMeta::from(&page)),
                            Err(e) => {
                                debug!("Failed to read encrypted sheet {}/{}: {}", content_type.id, name, e);
                            }
                        }
                    }
                }
            }
        }

        sheets.sort_by_key(|a| std::cmp::Reverse(a.modified_at));
        Ok(sheets)
    }

    /// Read and decrypt a sheet
    pub async fn read_sheet(&self, content_type: &ContentType, name: &str, date: Option<NaiveDate>) -> Result<Page, StorageError> {
        // Handle built-in types by delegating to existing methods
        if content_type.id == "page" {
            return self.read_page(name).await;
        }
        if content_type.id == "journal" {
            let journal_date = NaiveDate::parse_from_str(name, "%Y-%m-%d")
                .map_err(|_| StorageError::NotFound(format!("Invalid journal date: {}", name)))?;
            return self.read_journal(journal_date).await;
        }
        validate_safe_name(name)?;
        validate_safe_name(&content_type.directory)?;
        let path = self.sheet_path(content_type, name, date);

        // Backwards compat: try encoded path first, fall back to raw path
        let path = if !path.exists() {
            let raw_path = self.raw_sheet_path(content_type, name, date);
            if raw_path.exists() {
                raw_path
            } else {
                return Err(StorageError::NotFound(format!("{}/{}", content_type.id, name)));
            }
        } else {
            path
        };

        let encrypted = tokio::fs::read(&path).await?;
        let content = decrypt(&encrypted, &self.passphrase).map_err(|e| match e {
            EncryptionError::WrongPassphrase => StorageError::Other("Wrong passphrase".to_string()),
            _ => StorageError::Other(format!("Decryption failed: {}", e)),
        })?;

        let mut page = parse_markdown(&content, name)
            .map_err(|e| StorageError::ParseError(e.to_string()))?;

        // Set the full page name with directory path for block index storage
        // Format: directory/name or directory/YYYY-MM-DD/name for saveByDate
        page.name = if content_type.is_date_foldered() {
            if let Some(d) = date {
                format!("{}/{}/{}", content_type.directory, d.format("%Y-%m-%d"), name)
            } else {
                format!("{}/{}", content_type.directory, name)
            }
        } else {
            format!("{}/{}", content_type.directory, name)
        };

        // Set content type
        page.content_type = content_type.id.clone();

        // Set journal_date for saveByDate content types (used for building URLs)
        if content_type.is_date_foldered() {
            page.journal_date = date;
        }

        let metadata = tokio::fs::metadata(&path).await?;
        if let Ok(modified) = metadata.modified() {
            page.modified_at = modified.into();
        }
        if let Ok(created) = metadata.created() {
            page.created_at = created.into();
        }

        Ok(page)
    }

    /// Encrypt and write a sheet
    pub async fn write_sheet(&self, content_type: &ContentType, page: &Page, date: Option<NaiveDate>) -> Result<(), StorageError> {
        // Handle built-in types by delegating to existing methods
        if content_type.id == "page" || content_type.id == "journal" {
            return self.write_page(page).await;
        }

        // Extract the sheet name from page.name, which may contain the full path
        // Format: directory/name or directory/YYYY-MM-DD/name
        let sheet_name = if page.name.starts_with(&content_type.directory) && page.name.contains('/') {
            // Strip directory prefix and optional date
            let without_dir = &page.name[content_type.directory.len() + 1..];
            if content_type.is_date_foldered() && without_dir.contains('/') {
                // Format: YYYY-MM-DD/name - extract name after date
                without_dir.split_once('/').map_or(without_dir, |(_, rest)| rest)
            } else {
                without_dir
            }
        } else {
            &page.name
        };

        validate_safe_name(sheet_name)?;
        validate_safe_name(&content_type.directory)?;
        self.ensure_content_type_dir(content_type, date).await?;
        let path = self.sheet_path(content_type, sheet_name, date);
        self.write_file(&path, page).await
    }

    /// Delete an encrypted sheet
    pub async fn delete_sheet(&self, content_type: &ContentType, name: &str, date: Option<NaiveDate>) -> Result<(), StorageError> {
        // Handle built-in types by delegating to existing methods
        if content_type.id == "page" {
            return self.delete_page(name).await;
        }
        if content_type.id == "journal" {
            // For journals, the name IS the date (YYYY-MM-DD)
            let journal_date = NaiveDate::parse_from_str(name, "%Y-%m-%d")
                .map_err(|_| StorageError::NotFound(format!("Invalid journal date: {}", name)))?;
            let path = self.journal_path(journal_date);
            if !path.exists() {
                return Err(StorageError::NotFound(format!("Journal not found: {}", name)));
            }
            tokio::fs::remove_file(&path).await?;
            info!("Deleted encrypted journal: {}", name);
            return Ok(());
        }

        validate_safe_name(name)?;
        validate_safe_name(&content_type.directory)?;
        let path = self.sheet_path(content_type, name, date);

        // Backwards compat: try encoded path first, fall back to raw path
        let path = if !path.exists() {
            let raw_path = self.raw_sheet_path(content_type, name, date);
            if raw_path.exists() {
                raw_path
            } else {
                return Err(StorageError::NotFound(format!("{}/{}", content_type.id, name)));
            }
        } else {
            path
        };

        let _guard = self.write_lock.read().await;

        {
            let mut pending = self.pending_writes.write().await;
            pending.insert(path.clone());
        }

        tokio::fs::remove_file(&path).await?;

        info!("Deleted encrypted sheet: {}/{}", content_type.id, name);

        Ok(())
    }

    /// Check if an encrypted sheet exists
    pub async fn sheet_exists(&self, content_type: &ContentType, name: &str, date: Option<NaiveDate>) -> bool {
        // Handle built-in types
        if content_type.id == "page" {
            return self.page_exists(name).await;
        }
        if content_type.id == "journal" {
            // For journals, the name IS the date (YYYY-MM-DD)
            if let Ok(journal_date) = NaiveDate::parse_from_str(name, "%Y-%m-%d") {
                return self.journal_path(journal_date).exists();
            }
            return false;
        }

        if validate_safe_name(name).is_err() || validate_safe_name(&content_type.directory).is_err() {
            return false;
        }
        if self.sheet_path(content_type, name, date).exists() {
            return true;
        }
        // Backwards compat: check raw path
        self.raw_sheet_path(content_type, name, date).exists()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    async fn setup() -> (TempDir, EncryptedFileManager) {
        let temp_dir = TempDir::new().unwrap();
        let passphrase = "test-passphrase";

        // Create verification file
        let verify_path = temp_dir.path().join(".tend").join("encryption.verify");
        std::fs::create_dir_all(verify_path.parent().unwrap()).unwrap();
        let verify_content = encrypt("tend-encryption-verification", passphrase).unwrap();
        std::fs::write(&verify_path, verify_content).unwrap();

        let efm = EncryptedFileManager::new(temp_dir.path(), passphrase.to_string()).unwrap();
        (temp_dir, efm)
    }

    #[tokio::test]
    async fn test_verify_passphrase() {
        let (temp_dir, _efm) = setup().await;

        assert!(EncryptedFileManager::verify_passphrase(temp_dir.path(), "test-passphrase").unwrap());
        assert!(!EncryptedFileManager::verify_passphrase(temp_dir.path(), "wrong-passphrase").unwrap());
    }

    #[tokio::test]
    async fn test_encrypted_write_and_read_page() {
        let (_temp_dir, efm) = setup().await;

        let mut page = Page::new("Secret Page");
        let block = tend_core::Block::new("Top secret content!");
        page.add_block(block);

        efm.write_page(&page).await.unwrap();

        let read_page = efm.read_page("Secret Page").await.unwrap();
        assert_eq!(read_page.name, "Secret Page");
        assert_eq!(read_page.blocks.len(), 1);
    }

    #[tokio::test]
    async fn test_encrypted_journal() {
        let (_temp_dir, efm) = setup().await;

        let date = NaiveDate::from_ymd_opt(2025, 1, 20).unwrap();
        let mut page = Page::new_journal(date);
        let block = tend_core::Block::new("Encrypted journal entry");
        page.add_block(block);

        efm.write_page(&page).await.unwrap();

        let read_page = efm.read_journal(date).await.unwrap();
        assert!(read_page.is_journal);
        assert_eq!(read_page.journal_date, Some(date));
    }

    #[tokio::test]
    async fn test_list_encrypted_pages() {
        let (_temp_dir, efm) = setup().await;

        for name in ["Page A", "Page B", "Page C"] {
            let mut page = Page::new(name);
            page.add_block(tend_core::Block::new("Content"));
            efm.write_page(&page).await.unwrap();
        }

        let pages = efm.list_pages().await.unwrap();
        assert_eq!(pages.len(), 3);
    }
}
