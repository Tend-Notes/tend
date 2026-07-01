// SPDX-License-Identifier: MIT WITH Commons-Clause
//! File system operations for Tend
//!
//! Handles reading/writing Markdown files with atomic operations.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::NaiveDate;
use tend_core::parser::{parse_journal_filename, parse_markdown};
use tend_core::serializer::serialize_page;
use tend_core::{ContentType, Page, PageMeta};
use tokio::sync::RwLock;
use tracing::{debug, info};

use crate::error::StorageError;

/// Characters that are unsafe in filenames across platforms (particularly Windows).
/// These are percent-encoded when constructing filesystem paths.
const UNSAFE_FILENAME_CHARS: &[char] = &['%', ':', '<', '>', '"', '|', '?', '*', '\\'];

/// Encode a page/sheet name for use as a filename.
/// Percent-encodes characters that are unsafe on some platforms.
pub fn encode_filename(name: &str) -> String {
    let mut result = String::with_capacity(name.len());
    for ch in name.chars() {
        if ch == '%' {
            result.push_str("%25");
        } else if UNSAFE_FILENAME_CHARS.contains(&ch) || ch.is_control() {
            let mut buf = [0u8; 4];
            for byte in ch.encode_utf8(&mut buf).bytes() {
                result.push_str(&format!("%{:02X}", byte));
            }
        } else {
            result.push(ch);
        }
    }
    result
}

/// Decode a filename back to the original page/sheet name.
/// Reverses the percent-encoding applied by `encode_filename`.
pub fn decode_filename(encoded: &str) -> String {
    let mut result = String::with_capacity(encoded.len());
    let bytes = encoded.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex_str) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(byte_val) = u8::from_str_radix(hex_str, 16) {
                    result.push(byte_val as char);
                    i += 3;
                    continue;
                }
            }
        }
        result.push(bytes[i] as char);
        i += 1;
    }
    result
}

/// Validates that a name is safe for use in file paths.
/// Rejects path traversal attempts, absolute paths, and null bytes.
pub fn validate_safe_name(name: &str) -> Result<(), StorageError> {
    if name.is_empty() {
        return Err(StorageError::InvalidPath("Name cannot be empty".into()));
    }
    if name.contains("..") {
        return Err(StorageError::InvalidPath("Name cannot contain '..'".into()));
    }
    if name.starts_with('/') || name.starts_with('\\') {
        return Err(StorageError::InvalidPath("Name cannot be an absolute path".into()));
    }
    if name.contains('\0') {
        return Err(StorageError::InvalidPath("Name cannot contain null bytes".into()));
    }
    if name.chars().any(|c| c.is_control()) {
        return Err(StorageError::InvalidPath(
            "Name cannot contain control characters".into(),
        ));
    }
    Ok(())
}

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
        self.root.join("pages").join(format!("{}.md", encode_filename(name)))
    }

    /// Check if a path is one we're currently writing
    pub async fn is_pending_write(&self, path: &Path) -> bool {
        self.pending_writes.read().await.contains(path)
    }

    /// Get a reference to pending writes for the watcher
    pub fn pending_writes(&self) -> Arc<RwLock<HashSet<PathBuf>>> {
        Arc::clone(&self.pending_writes)
    }

    /// List all pages (thin wrapper over the unified sheet path).
    pub async fn list_pages(&self) -> Result<Vec<PageMeta>, StorageError> {
        self.list_sheets(&ContentType::page()).await
    }

    /// List all journals (thin wrapper over the unified sheet path).
    pub async fn list_journals(&self) -> Result<Vec<PageMeta>, StorageError> {
        self.list_sheets(&ContentType::journal()).await
    }

    /// Read a page by name (thin wrapper over the unified sheet path).
    pub async fn read_page(&self, name: &str) -> Result<Page, StorageError> {
        self.read_sheet(&ContentType::page(), name, None).await
    }

    /// Read a journal by date (thin wrapper over the unified sheet path).
    pub async fn read_journal(&self, date: NaiveDate) -> Result<Page, StorageError> {
        let name = date.format("%Y-%m-%d").to_string();
        self.read_sheet(&ContentType::journal(), &name, None).await
    }

    /// Write a page or journal (thin wrapper over the unified sheet path).
    pub async fn write_page(&self, page: &Page) -> Result<(), StorageError> {
        let content_type = if page.is_journal {
            ContentType::journal()
        } else {
            ContentType::page()
        };
        self.write_sheet(&content_type, page, page.journal_date).await
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

        // Ensure parent directory exists (for nested page names like "meeting/2026-01-23/Name")
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        // Write to temp file
        tokio::fs::write(&tmp_path, &content).await?;

        // Atomic rename
        tokio::fs::rename(&tmp_path, path).await?;

        // Remove from pending writes after a delay to ensure file watcher
        // events are properly ignored. The delay needs to be long enough to:
        // 1. Allow the file watcher debounce to process the event
        // 2. Give the client time to update its state after save completes
        // Using 1000ms provides a reasonable buffer.
        let pending_writes = Arc::clone(&self.pending_writes);
        let path_buf = path.to_path_buf();
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
            let mut pending = pending_writes.write().await;
            pending.remove(&path_buf);
        });

        debug!("Wrote page: {}", path.display());

        Ok(())
    }

    /// Delete a page (thin wrapper over the unified sheet path).
    pub async fn delete_page(&self, name: &str) -> Result<(), StorageError> {
        self.delete_sheet(&ContentType::page(), name, None).await
    }

    /// Check if a page exists (thin wrapper over the unified sheet path).
    pub async fn page_exists(&self, name: &str) -> bool {
        self.sheet_exists(&ContentType::page(), name, None).await
    }

    /// Check if a journal exists (thin wrapper over the unified sheet path).
    pub async fn journal_exists(&self, date: NaiveDate) -> bool {
        let name = date.format("%Y-%m-%d").to_string();
        self.sheet_exists(&ContentType::journal(), &name, None).await
    }

    /// Acquire exclusive lock (for git backup)
    pub async fn acquire_exclusive_lock(&self) -> tokio::sync::RwLockWriteGuard<'_, ()> {
        info!("Acquiring exclusive lock for backup");
        self.write_lock.write().await
    }

    // ========== Sheet (Content Type) Operations ==========

    /// Get path to a sheet file for a content type
    /// If save_by_date is true, includes date subfolder: {directory}/{date}/{name}.md
    /// Otherwise: {directory}/{name}.md
    pub fn sheet_path(&self, content_type: &ContentType, name: &str, date: Option<NaiveDate>) -> PathBuf {
        let dir = self.root.join(&content_type.directory);
        if content_type.is_date_foldered() {
            if let Some(d) = date {
                dir.join(d.format("%Y-%m-%d").to_string()).join(format!("{}.md", encode_filename(name)))
            } else {
                let today = chrono::Local::now().date_naive();
                dir.join(today.format("%Y-%m-%d").to_string()).join(format!("{}.md", encode_filename(name)))
            }
        } else {
            dir.join(format!("{}.md", encode_filename(name)))
        }
    }

    /// Raw (unencoded) sheet path for backwards compatibility with pre-encoding files
    fn raw_sheet_path(&self, content_type: &ContentType, name: &str, date: Option<NaiveDate>) -> PathBuf {
        let dir = self.root.join(&content_type.directory);
        if content_type.is_date_foldered() {
            if let Some(d) = date {
                dir.join(d.format("%Y-%m-%d").to_string()).join(format!("{}.md", name))
            } else {
                let today = chrono::Local::now().date_naive();
                dir.join(today.format("%Y-%m-%d").to_string()).join(format!("{}.md", name))
            }
        } else {
            dir.join(format!("{}.md", name))
        }
    }

    /// Ensure content type directory exists (and date subdirectory if save_by_date)
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

    /// List all sheets of a content type.
    ///
    /// One code path for every type, driven by `organization`. Pages and
    /// custom-flat types list a flat directory; journals (date-named) list only
    /// date-named files; date-foldered types descend into date subdirectories.
    pub async fn list_sheets(&self, content_type: &ContentType) -> Result<Vec<PageMeta>, StorageError> {
        let base_dir = self.root.join(&content_type.directory);

        if !base_dir.exists() {
            return Ok(Vec::new());
        }

        let mut sheets = Vec::new();

        if content_type.is_date_foldered() {
            // Scan date subdirectories
            let mut date_dirs = tokio::fs::read_dir(&base_dir).await?;
            while let Some(date_entry) = date_dirs.next_entry().await? {
                let date_path = date_entry.path();
                if date_path.is_dir() {
                    // Parse date from directory name
                    let date = date_path
                        .file_name()
                        .and_then(|s| s.to_str())
                        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());

                    let mut entries = tokio::fs::read_dir(&date_path).await?;
                    while let Some(entry) = entries.next_entry().await? {
                        let path = entry.path();
                        if path.extension().is_some_and(|e| e == "md") {
                            if let Some(raw_name) = path.file_stem().and_then(|s| s.to_str()) {
                                let name = decode_filename(raw_name);
                                match self.read_sheet(content_type, &name, date).await {
                                    Ok(page) => sheets.push(PageMeta::from(&page)),
                                    Err(e) => {
                                        debug!("Failed to read sheet {}/{}: {}", content_type.id, name, e);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } else {
            // Flat directory listing (page, journal, custom-flat).
            let mut entries = tokio::fs::read_dir(&base_dir).await?;
            while let Some(entry) = entries.next_entry().await? {
                let path = entry.path();
                if path.extension().is_none_or(|e| e != "md") {
                    continue;
                }
                let Some(filename) = path.file_name().and_then(|s| s.to_str()) else {
                    continue;
                };
                // Date-named types (journals): only date-named files, normalized
                // through the parsed date so legacy separators map to canonical.
                let name = if content_type.is_date_named() {
                    match parse_journal_filename(filename) {
                        Some(d) => d.format("%Y-%m-%d").to_string(),
                        None => continue,
                    }
                } else {
                    match path.file_stem().and_then(|s| s.to_str()) {
                        Some(stem) => decode_filename(stem),
                        None => continue,
                    }
                };
                match self.read_sheet(content_type, &name, None).await {
                    Ok(page) => sheets.push(PageMeta::from(&page)),
                    Err(e) => {
                        debug!("Failed to read sheet {}/{}: {}", content_type.id, name, e);
                    }
                }
            }
        }

        // Date-named types sort by date; everything else by modified time.
        if content_type.is_date_named() {
            sheets.sort_by_key(|a| std::cmp::Reverse(a.journal_date));
        } else {
            sheets.sort_by_key(|a| std::cmp::Reverse(a.modified_at));
        }

        Ok(sheets)
    }

    /// Read a sheet by content type, name, and optional date.
    ///
    /// `Page::name` is set bare for page/journal (`name_includes_directory() ==
    /// false`) and directory-prefixed otherwise. Journal-specific behavior
    /// (date identity, human title, auto-create-on-miss) is the isolated
    /// `id == "journal"` layer.
    pub async fn read_sheet(&self, content_type: &ContentType, name: &str, date: Option<NaiveDate>) -> Result<Page, StorageError> {
        validate_safe_name(name)?;
        // The directory is interpolated into the on-disk path via sheet_path, and
        // for page/journal it comes from user-editable config, so always validate
        // it (defends against `directory = "../.."` traversal).
        validate_safe_name(&content_type.directory)?;

        // For date-named types (journals) the name IS the date.
        let resolved_date = if content_type.is_date_named() {
            Some(
                NaiveDate::parse_from_str(name, "%Y-%m-%d")
                    .map_err(|_| StorageError::NotFound(format!("Invalid date: {}", name)))?,
            )
        } else {
            date
        };

        let path = self.sheet_path(content_type, name, resolved_date);

        // Backwards compat: try encoded path first, fall back to raw path.
        let path = if path.exists() {
            path
        } else {
            let raw_path = self.raw_sheet_path(content_type, name, resolved_date);
            if raw_path.exists() {
                raw_path
            } else if content_type.id == "journal" {
                // Journal-only: a missing date is an empty journal, not an error.
                return Ok(Page::new_journal(
                    resolved_date.expect("date-named type resolves a date"),
                ));
            } else {
                return Err(StorageError::NotFound(format!("{}/{}", content_type.id, name)));
            }
        };

        let content = tokio::fs::read_to_string(&path).await?;
        let mut page = parse_markdown(&content, name)
            .map_err(|e| StorageError::ParseError(e.to_string()))?;

        // Canonical page name (bare for page/journal, directory-prefixed
        // otherwise) via the shared name authority; this is the form the
        // block/link index stores.
        page.name = tend_core::qualify_name(content_type, name, resolved_date);

        // Set content type
        page.content_type = content_type.id.clone();

        // Associate a date for date-foldered types (used for building URLs).
        if content_type.is_date_foldered() {
            page.journal_date = resolved_date;
        }

        // Journal-specific fields (the isolated journal layer).
        if content_type.id == "journal" {
            let d = resolved_date.expect("journal resolves a date");
            page.is_journal = true;
            page.journal_date = Some(d);
            page.title = d.format("%A, %B %-d, %Y").to_string();
        }

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

    /// Write a sheet for a content type.
    pub async fn write_sheet(&self, content_type: &ContentType, page: &Page, date: Option<NaiveDate>) -> Result<(), StorageError> {
        // Journal: the filename is its date (the isolated journal layer).
        if content_type.id == "journal" {
            validate_safe_name(&content_type.directory)?;
            let d = page
                .journal_date
                .unwrap_or_else(|| chrono::Local::now().date_naive());
            let date_name = d.format("%Y-%m-%d").to_string();
            // Route through sheet_path so journal writes honor content_type.directory,
            // matching reads (no read/write directory asymmetry).
            let path = self.sheet_path(content_type, &date_name, Some(d));
            return self.write_file(&path, page).await;
        }

        // Decompose the canonical page.name to the bare sheet name via the
        // shared name authority.
        let (sheet_name, _) = tend_core::split_name(content_type, &page.name);

        validate_safe_name(sheet_name)?;
        validate_safe_name(&content_type.directory)?;

        // Ensure directory exists
        self.ensure_content_type_dir(content_type, date).await?;

        let path = self.sheet_path(content_type, sheet_name, date);
        self.write_file(&path, page).await
    }

    /// Delete a sheet.
    pub async fn delete_sheet(&self, content_type: &ContentType, name: &str, date: Option<NaiveDate>) -> Result<(), StorageError> {
        // Journal: the name IS the date (the isolated journal layer).
        let path = if content_type.id == "journal" {
            validate_safe_name(&content_type.directory)?;
            let journal_date = NaiveDate::parse_from_str(name, "%Y-%m-%d")
                .map_err(|_| StorageError::NotFound(format!("Invalid journal date: {}", name)))?;
            let date_name = journal_date.format("%Y-%m-%d").to_string();
            let path = self.sheet_path(content_type, &date_name, None);
            if !path.exists() {
                return Err(StorageError::NotFound(format!("Journal not found: {}", name)));
            }
            path
        } else {
            validate_safe_name(name)?;
            validate_safe_name(&content_type.directory)?;
            let path = self.sheet_path(content_type, name, date);

            // Backwards compat: try encoded path first, fall back to raw path
            if path.exists() {
                path
            } else {
                let raw_path = self.raw_sheet_path(content_type, name, date);
                if raw_path.exists() {
                    raw_path
                } else {
                    return Err(StorageError::NotFound(format!("{}/{}", content_type.id, name)));
                }
            }
        };

        // Acquire read lock
        let _guard = self.write_lock.read().await;

        // Mark as pending write
        {
            let mut pending = self.pending_writes.write().await;
            pending.insert(path.clone());
        }

        tokio::fs::remove_file(&path).await?;

        info!("Deleted sheet: {}/{}", content_type.id, name);

        Ok(())
    }

    /// Check if a sheet exists.
    pub async fn sheet_exists(&self, content_type: &ContentType, name: &str, date: Option<NaiveDate>) -> bool {
        if validate_safe_name(name).is_err() {
            return false;
        }
        if validate_safe_name(&content_type.directory).is_err() {
            return false;
        }
        self.sheet_path(content_type, name, date).exists()
            || self.raw_sheet_path(content_type, name, date).exists()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use tend_core::Organization;

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

    fn flat_type() -> ContentType {
        ContentType::new("person", "Person", "person")
    }

    fn dated_type() -> ContentType {
        let mut ct = ContentType::new("meeting", "Meeting", "meeting");
        ct.organization = Organization::DateFoldered;
        ct
    }

    #[tokio::test]
    async fn test_sheet_roundtrip_flat_custom_type() {
        let (temp_dir, fm) = setup().await;
        let ct = flat_type();

        // Custom-flat types embed the directory in page.name.
        let mut page = Page::new_sheet("person/John", "person", None);
        page.add_block(tend_core::Block::new("Bio"));
        fm.write_sheet(&ct, &page, None).await.unwrap();

        // Stored flat under the directory, file named by the bare name.
        assert!(temp_dir.path().join("person").join("John.md").exists());

        let read = fm.read_sheet(&ct, "John", None).await.unwrap();
        assert_eq!(read.name, "person/John");
        assert_eq!(read.content_type, "person");
        assert!(!read.is_journal);
        assert_eq!(read.journal_date, None);
        assert_eq!(read.blocks.len(), 1);

        let list = fm.list_sheets(&ct).await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "person/John");

        assert!(fm.sheet_exists(&ct, "John", None).await);
        fm.delete_sheet(&ct, "John", None).await.unwrap();
        assert!(!fm.sheet_exists(&ct, "John", None).await);
    }

    #[tokio::test]
    async fn test_sheet_roundtrip_date_foldered_custom_type() {
        let (temp_dir, fm) = setup().await;
        let ct = dated_type();
        let date = NaiveDate::from_ymd_opt(2026, 1, 30).unwrap();

        let mut page = Page::new_sheet("meeting/2026-01-30/Standup", "meeting", Some(date));
        page.add_block(tend_core::Block::new("Agenda"));
        fm.write_sheet(&ct, &page, Some(date)).await.unwrap();

        // Stored under a date subfolder.
        assert!(temp_dir
            .path()
            .join("meeting")
            .join("2026-01-30")
            .join("Standup.md")
            .exists());

        let read = fm.read_sheet(&ct, "Standup", Some(date)).await.unwrap();
        assert_eq!(read.name, "meeting/2026-01-30/Standup");
        assert_eq!(read.content_type, "meeting");
        assert_eq!(read.journal_date, Some(date));
        assert_eq!(read.blocks.len(), 1);

        let list = fm.list_sheets(&ct).await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "meeting/2026-01-30/Standup");
    }

    #[tokio::test]
    async fn test_page_and_journal_via_unified_sheet_api() {
        let (_temp_dir, fm) = setup().await;

        // A page read through the generic sheet API keeps its bare name.
        let mut page = Page::new("Plain Page");
        page.add_block(tend_core::Block::new("x"));
        fm.write_sheet(&ContentType::page(), &page, None).await.unwrap();
        let read = fm.read_sheet(&ContentType::page(), "Plain Page", None).await.unwrap();
        assert_eq!(read.name, "Plain Page");
        assert_eq!(read.content_type, "page");

        // A journal read through the generic sheet API: bare date name, journal fields.
        let date = NaiveDate::from_ymd_opt(2026, 3, 4).unwrap();
        let mut j = Page::new_journal(date);
        j.add_block(tend_core::Block::new("y"));
        fm.write_sheet(&ContentType::journal(), &j, Some(date)).await.unwrap();
        let read = fm.read_sheet(&ContentType::journal(), "2026-03-04", None).await.unwrap();
        assert_eq!(read.name, "2026-03-04");
        assert!(read.is_journal);
        assert_eq!(read.journal_date, Some(date));

        // Missing journal auto-creates an empty page (journal-only behavior).
        let missing = fm.read_sheet(&ContentType::journal(), "2099-12-31", None).await.unwrap();
        assert!(missing.is_journal);
        assert_eq!(missing.blocks.len(), 0);

        // A missing custom-flat sheet is a NotFound, not an empty page.
        assert!(fm.read_sheet(&flat_type(), "Nope", None).await.is_err());
    }

    #[tokio::test]
    async fn test_tampered_directory_rejected() {
        let (_temp_dir, fm) = setup().await;

        // A "page" content type whose directory escapes the garden root must be
        // rejected on every storage method, even though page uses a bare name.
        let mut evil = ContentType::page();
        evil.directory = "../escape".to_string();
        let mut page = Page::new("X");
        page.add_block(tend_core::Block::new("y"));
        assert!(fm.write_sheet(&evil, &page, None).await.is_err());
        assert!(fm.read_sheet(&evil, "X", None).await.is_err());
        assert!(!fm.sheet_exists(&evil, "X", None).await);

        // Journal writes also validate the directory now (no read/write asymmetry).
        let mut evil_journal = ContentType::journal();
        evil_journal.directory = "../escape".to_string();
        let date = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        let j = Page::new_journal(date);
        assert!(fm.write_sheet(&evil_journal, &j, Some(date)).await.is_err());
        assert!(fm.read_sheet(&evil_journal, "2026-01-01", None).await.is_err());
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

    #[test]
    fn test_validate_safe_name() {
        // Valid names (including characters that get encoded for filesystem)
        assert!(validate_safe_name("My Page").is_ok());
        assert!(validate_safe_name("nested/page").is_ok());
        assert!(validate_safe_name("Meeting Notes 2026").is_ok());
        assert!(validate_safe_name("1:1 Jamie Parker").is_ok());
        assert!(validate_safe_name("Q&A: Session Notes").is_ok());

        // Invalid: path traversal
        assert!(validate_safe_name("../secret").is_err());
        assert!(validate_safe_name("foo/../bar").is_err());
        assert!(validate_safe_name("..").is_err());

        // Invalid: absolute paths
        assert!(validate_safe_name("/etc/passwd").is_err());
        assert!(validate_safe_name("\\Windows\\System32").is_err());

        // Invalid: null bytes
        assert!(validate_safe_name("page\0name").is_err());

        // Invalid: empty
        assert!(validate_safe_name("").is_err());
    }

    #[test]
    fn test_encode_decode_filename() {
        // No encoding needed
        assert_eq!(encode_filename("My Page"), "My Page");
        assert_eq!(encode_filename("Meeting Notes 2026"), "Meeting Notes 2026");

        // Colon encoding
        assert_eq!(encode_filename("1:1 Jamie Parker"), "1%3A1 Jamie Parker");
        assert_eq!(decode_filename("1%3A1 Jamie Parker"), "1:1 Jamie Parker");

        // Multiple special chars
        assert_eq!(encode_filename("Q&A: \"Test\""), "Q&A%3A %22Test%22");

        // Percent itself is encoded first
        assert_eq!(encode_filename("100% Done"), "100%25 Done");
        assert_eq!(decode_filename("100%25 Done"), "100% Done");

        // Round-trip preserves original
        for name in ["1:1 Jamie Parker", "file?.md", "a|b*c", "100% Done"] {
            assert_eq!(decode_filename(&encode_filename(name)), name);
        }

        // No-op for safe names
        for name in ["My Page", "nested/page", "simple"] {
            assert_eq!(encode_filename(name), name);
        }
    }

    #[tokio::test]
    async fn test_path_traversal_blocked_read() {
        let (_temp_dir, fm) = setup().await;

        let result = fm.read_page("../secret").await;
        assert!(matches!(result, Err(StorageError::InvalidPath(_))));

        let result = fm.read_page("/etc/passwd").await;
        assert!(matches!(result, Err(StorageError::InvalidPath(_))));
    }

    #[tokio::test]
    async fn test_path_traversal_blocked_write() {
        let (_temp_dir, fm) = setup().await;

        let mut page = Page::new("../secret");
        page.add_block(tend_core::Block::new("Content"));
        let result = fm.write_page(&page).await;
        assert!(matches!(result, Err(StorageError::InvalidPath(_))));
    }

    #[tokio::test]
    async fn test_path_traversal_blocked_delete() {
        let (_temp_dir, fm) = setup().await;

        let result = fm.delete_page("../secret").await;
        assert!(matches!(result, Err(StorageError::InvalidPath(_))));
    }

    #[tokio::test]
    async fn test_path_traversal_page_exists() {
        let (_temp_dir, fm) = setup().await;

        // Should return false (not crash) for traversal attempts
        assert!(!fm.page_exists("../secret").await);
        assert!(!fm.page_exists("/etc/passwd").await);
    }
}
