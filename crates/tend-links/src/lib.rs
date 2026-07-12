// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Link index for efficient backlink lookups
//!
//! This crate provides a hashed link index that enables fast backlink queries.
//! Page names are hashed with SHA-256 for privacy and consistent key sizes.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use tend_core::Block;
use thiserror::Error;
use tokio::fs;
use tracing::{debug, info};
use uuid::Uuid;

/// Errors that can occur during link index operations
#[derive(Debug, Error)]
pub enum LinkError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Index not initialized")]
    NotInitialized,
}

/// Result type for link operations
pub type Result<T> = std::result::Result<T, LinkError>;

/// Type of link between pages
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LinkType {
    /// A [[wiki-link]] to another page
    WikiLink,
    /// A #tag reference
    Tag,
}

/// A single link entry in the index
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LinkEntry {
    /// SHA-256 hash of the source page name (normalized)
    pub source_hash: String,
    /// SHA-256 hash of the target page name (normalized)
    pub target_hash: String,
    /// The actual target name (for wikilink suggestions)
    /// Added in version 2 - may be None for entries from older indices
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_name: Option<String>,
    /// UUID of the block containing this link
    pub block_uuid: Uuid,
    /// Type of link (WikiLink or Tag)
    pub link_type: LinkType,
}

/// Result of a backlink query
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BacklinkResult {
    /// SHA-256 hash of the source page
    pub source_hash: String,
    /// UUID of the block containing the link
    pub block_uuid: Uuid,
    /// Type of link
    pub link_type: LinkType,
}

/// Normalize a page name for consistent hashing
///
/// Normalization:
/// - Converts to lowercase
/// - Trims leading and trailing whitespace
fn normalize_page_name(name: &str) -> String {
    name.trim().to_lowercase()
}

/// Hash a page name using SHA-256
///
/// The name is normalized (lowercase, trimmed) before hashing.
pub fn hash_page_name(name: &str) -> String {
    let normalized = normalize_page_name(name);
    let mut hasher = Sha256::new();
    hasher.update(normalized.as_bytes());
    let result = hasher.finalize();
    hex::encode(result)
}

/// Internal storage format for the link index
#[derive(Debug, Default, Serialize, Deserialize)]
struct LinkIndexData {
    /// All link entries
    entries: Vec<LinkEntry>,
    /// Index version for future migrations
    version: u32,
}

impl LinkIndexData {
    // Version 2: Added target_name field to LinkEntry
    const CURRENT_VERSION: u32 = 2;

    fn new() -> Self {
        Self {
            entries: Vec::new(),
            version: Self::CURRENT_VERSION,
        }
    }
}

/// Link index for efficient backlink lookups
///
/// Stores links as hashed entries in a JSON file. Supports indexing pages,
/// removing pages, and querying backlinks.
pub struct LinkIndex {
    /// Path to the index directory
    path: PathBuf,
    /// In-memory link data
    data: LinkIndexData,
    /// Index from target_hash to entry indices for fast backlink lookups
    target_index: HashMap<String, Vec<usize>>,
    /// Index from source_hash to entry indices for fast page removal
    source_index: HashMap<String, Vec<usize>>,
    /// When false the index is RAM-only and `persist()` is a no-op, so page and
    /// link names never touch the disk in plaintext (used for encrypted gardens).
    persistent: bool,
}

impl LinkIndex {
    /// Create or load a link index at the given path
    ///
    /// If the index file exists, it will be loaded. Otherwise, a new empty
    /// index will be created.
    pub async fn new(path: PathBuf) -> Result<Self> {
        let index_file = path.join("links.json");

        let data = if index_file.exists() {
            info!(?index_file, "Loading existing link index");
            let contents = fs::read_to_string(&index_file).await?;
            serde_json::from_str(&contents)?
        } else {
            info!(?index_file, "Creating new link index");
            LinkIndexData::new()
        };

        let mut index = Self {
            path,
            data,
            target_index: HashMap::new(),
            source_index: HashMap::new(),
            persistent: true,
        };

        index.rebuild_indices();
        Ok(index)
    }

    /// Create an empty, RAM-only link index that never writes to disk.
    ///
    /// Used for encrypted gardens: the index is populated by rebuilding from the
    /// decrypted pages on unlock and lives only while the garden is unlocked, so
    /// no plaintext page/link names are ever persisted.
    pub fn in_memory() -> Self {
        Self {
            path: PathBuf::new(),
            data: LinkIndexData::new(),
            target_index: HashMap::new(),
            source_index: HashMap::new(),
            persistent: false,
        }
    }

    /// Rebuild the in-memory lookup indices from the entry list
    fn rebuild_indices(&mut self) {
        self.target_index.clear();
        self.source_index.clear();

        for (idx, entry) in self.data.entries.iter().enumerate() {
            self.target_index
                .entry(entry.target_hash.clone())
                .or_default()
                .push(idx);
            self.source_index
                .entry(entry.source_hash.clone())
                .or_default()
                .push(idx);
        }
    }

    /// Persist the index to disk
    async fn persist(&self) -> Result<()> {
        // RAM-only indices (encrypted gardens) never touch the disk.
        if !self.persistent {
            return Ok(());
        }
        fs::create_dir_all(&self.path).await?;
        // Owner-only: the link index leaks page/link names in plaintext.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&self.path, std::fs::Permissions::from_mode(0o700));
        }
        let index_file = self.path.join("links.json");
        let contents = serde_json::to_string_pretty(&self.data)?;
        fs::write(&index_file, contents).await?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&index_file, std::fs::Permissions::from_mode(0o600));
        }
        debug!(?index_file, entries = self.data.entries.len(), "Persisted link index");
        Ok(())
    }

    /// Index a page, extracting all links from its blocks
    ///
    /// This will remove any existing links from this page before adding new ones.
    pub async fn index_page<'b>(
        &mut self,
        page_name: &str,
        blocks: impl IntoIterator<Item = &'b Block>,
    ) -> Result<()> {
        let source_hash = hash_page_name(page_name);
        debug!(%page_name, %source_hash, "Indexing page");

        // Remove existing links from this page
        self.remove_page_internal(&source_hash);

        // Extract and add new links
        let mut new_entries = Vec::new();

        for block in blocks {
            // Extract wiki-links
            for target in block.extract_wiki_links() {
                let target_hash = hash_page_name(&target);
                new_entries.push(LinkEntry {
                    source_hash: source_hash.clone(),
                    target_hash,
                    target_name: Some(target),
                    block_uuid: block.uuid,
                    link_type: LinkType::WikiLink,
                });
            }

            // Extract tags (treated as links to tag pages)
            for tag in block.extract_tags() {
                let target_hash = hash_page_name(&tag);
                new_entries.push(LinkEntry {
                    source_hash: source_hash.clone(),
                    target_hash,
                    target_name: Some(tag),
                    block_uuid: block.uuid,
                    link_type: LinkType::Tag,
                });
            }
        }

        debug!(
            %page_name,
            new_links = new_entries.len(),
            "Extracted links from page"
        );

        // Add new entries and update indices
        let start_idx = self.data.entries.len();
        for (i, entry) in new_entries.into_iter().enumerate() {
            let idx = start_idx + i;
            self.target_index
                .entry(entry.target_hash.clone())
                .or_default()
                .push(idx);
            self.source_index
                .entry(entry.source_hash.clone())
                .or_default()
                .push(idx);
            self.data.entries.push(entry);
        }

        self.persist().await
    }

    /// Remove all links originating from a page
    pub async fn remove_page(&mut self, page_name: &str) -> Result<()> {
        let source_hash = hash_page_name(page_name);
        debug!(%page_name, %source_hash, "Removing page from link index");

        self.remove_page_internal(&source_hash);
        self.persist().await
    }

    /// Internal method to remove links by source hash without persisting
    fn remove_page_internal(&mut self, source_hash: &str) {
        if let Some(indices) = self.source_index.remove(source_hash) {
            // Mark entries for removal by collecting indices to remove
            let indices_set: std::collections::HashSet<_> = indices.into_iter().collect();

            // Remove entries and rebuild indices
            self.data.entries = self
                .data
                .entries
                .drain(..)
                .enumerate()
                .filter(|(idx, _)| !indices_set.contains(idx))
                .map(|(_, entry)| entry)
                .collect();

            self.rebuild_indices();
        }
    }

    /// Get all backlinks pointing to a page
    ///
    /// Returns information about blocks that link to the specified page.
    pub fn get_backlinks(&self, page_name: &str) -> Vec<BacklinkResult> {
        let target_hash = hash_page_name(page_name);
        debug!(%page_name, %target_hash, "Getting backlinks");

        let indices = match self.target_index.get(&target_hash) {
            Some(indices) => indices,
            None => return Vec::new(),
        };

        indices
            .iter()
            .filter_map(|&idx| self.data.entries.get(idx))
            .map(|entry| BacklinkResult {
                source_hash: entry.source_hash.clone(),
                block_uuid: entry.block_uuid,
                link_type: entry.link_type,
            })
            .collect()
    }

    /// Rebuild the entire index from a collection of pages
    ///
    /// This clears the existing index and rebuilds it from scratch.
    pub async fn rebuild_all<I>(&mut self, pages: I) -> Result<()>
    where
        I: Iterator<Item = (String, Vec<Block>)>,
    {
        info!("Rebuilding entire link index");

        // Clear existing data
        self.data = LinkIndexData::new();
        self.target_index.clear();
        self.source_index.clear();

        // Index all pages
        let mut page_count = 0;
        let mut link_count = 0;

        for (page_name, blocks) in pages {
            let source_hash = hash_page_name(&page_name);

            for block in &blocks {
                // Extract wiki-links
                for target in block.extract_wiki_links() {
                    let target_hash = hash_page_name(&target);
                    let idx = self.data.entries.len();
                    let entry = LinkEntry {
                        source_hash: source_hash.clone(),
                        target_hash: target_hash.clone(),
                        target_name: Some(target),
                        block_uuid: block.uuid,
                        link_type: LinkType::WikiLink,
                    };
                    self.target_index.entry(entry.target_hash.clone()).or_default().push(idx);
                    self.source_index
                        .entry(source_hash.clone())
                        .or_default()
                        .push(idx);
                    self.data.entries.push(entry);
                    link_count += 1;
                }

                // Extract tags
                for tag in block.extract_tags() {
                    let target_hash = hash_page_name(&tag);
                    let idx = self.data.entries.len();
                    let entry = LinkEntry {
                        source_hash: source_hash.clone(),
                        target_hash: target_hash.clone(),
                        target_name: Some(tag),
                        block_uuid: block.uuid,
                        link_type: LinkType::Tag,
                    };
                    self.target_index.entry(entry.target_hash.clone()).or_default().push(idx);
                    self.source_index
                        .entry(source_hash.clone())
                        .or_default()
                        .push(idx);
                    self.data.entries.push(entry);
                    link_count += 1;
                }
            }

            page_count += 1;
        }

        info!(
            pages = page_count,
            links = link_count,
            "Rebuilt link index"
        );

        self.persist().await
    }

    /// Get the total number of link entries in the index
    pub fn len(&self) -> usize {
        self.data.entries.len()
    }

    /// Check if the index is empty
    pub fn is_empty(&self) -> bool {
        self.data.entries.is_empty()
    }

    /// Get all unique wikilink target names
    ///
    /// Returns a list of all page names that have been referenced via wikilinks,
    /// regardless of whether those pages actually exist. This is useful for
    /// autocomplete suggestions.
    ///
    /// Only returns targets that have a stored name (entries from index version 2+).
    pub fn get_wikilink_targets(&self) -> Vec<String> {
        use std::collections::HashSet;

        let mut targets: HashSet<String> = HashSet::new();

        for entry in &self.data.entries {
            if entry.link_type == LinkType::WikiLink {
                if let Some(name) = &entry.target_name {
                    targets.insert(name.clone());
                }
            }
        }

        targets.into_iter().collect()
    }
}

// We need hex encoding for SHA-256 output
mod hex {
    const HEX_CHARS: &[u8; 16] = b"0123456789abcdef";

    pub fn encode(bytes: impl AsRef<[u8]>) -> String {
        let bytes = bytes.as_ref();
        let mut hex = String::with_capacity(bytes.len() * 2);
        for &byte in bytes {
            hex.push(HEX_CHARS[(byte >> 4) as usize] as char);
            hex.push(HEX_CHARS[(byte & 0xf) as usize] as char);
        }
        hex
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_hash_page_name_normalization() {
        // Same hash for different capitalizations
        assert_eq!(hash_page_name("My Page"), hash_page_name("my page"));
        assert_eq!(hash_page_name("MY PAGE"), hash_page_name("my page"));

        // Same hash with trimmed whitespace
        assert_eq!(hash_page_name("  My Page  "), hash_page_name("My Page"));
    }

    #[test]
    fn test_hash_page_name_deterministic() {
        let hash1 = hash_page_name("Test Page");
        let hash2 = hash_page_name("Test Page");
        assert_eq!(hash1, hash2);

        // SHA-256 produces 64 hex characters
        assert_eq!(hash1.len(), 64);
    }

    #[tokio::test]
    async fn test_link_index_new() {
        let temp_dir = TempDir::new().unwrap();
        let index = LinkIndex::new(temp_dir.path().to_path_buf()).await.unwrap();
        assert!(index.is_empty());
    }

    #[tokio::test]
    async fn test_index_page_with_wiki_links() {
        let temp_dir = TempDir::new().unwrap();
        let mut index = LinkIndex::new(temp_dir.path().to_path_buf()).await.unwrap();

        let blocks = vec![
            Block::new("Check out [[Target Page]] for more info"),
            Block::new("Also see [[Another Page]]"),
        ];

        index.index_page("Source Page", &blocks).await.unwrap();

        // Should have 2 link entries
        assert_eq!(index.len(), 2);

        // Query backlinks to Target Page
        let backlinks = index.get_backlinks("Target Page");
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].link_type, LinkType::WikiLink);
        assert_eq!(backlinks[0].source_hash, hash_page_name("Source Page"));
    }

    #[tokio::test]
    async fn test_in_memory_index_never_writes_to_disk() {
        // Point the CWD-independent check at a temp dir: an in-memory index
        // must not create any links.json even after indexing + a persist call.
        let temp_dir = TempDir::new().unwrap();
        let mut index = LinkIndex::in_memory();

        let blocks = vec![Block::new("Check out [[Target Page]]")];
        index.index_page("Source Page", &blocks).await.unwrap();

        // Backlinks work in memory...
        assert_eq!(index.len(), 1);
        let backlinks = index.get_backlinks("Target Page");
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].source_hash, hash_page_name("Source Page"));

        // ...but nothing is persisted: an explicit persist() is a no-op and
        // the temp dir stays empty.
        index.persist().await.unwrap();
        let entries: Vec<_> = std::fs::read_dir(temp_dir.path()).unwrap().collect();
        assert!(entries.is_empty(), "in-memory index must not write files");
    }

    #[tokio::test]
    async fn test_index_page_with_tags() {
        let temp_dir = TempDir::new().unwrap();
        let mut index = LinkIndex::new(temp_dir.path().to_path_buf()).await.unwrap();

        let blocks = vec![Block::new("This is #project and #important")];

        index.index_page("Notes", &blocks).await.unwrap();

        assert_eq!(index.len(), 2);

        let backlinks = index.get_backlinks("project");
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].link_type, LinkType::Tag);
    }

    #[tokio::test]
    async fn test_remove_page() {
        let temp_dir = TempDir::new().unwrap();
        let mut index = LinkIndex::new(temp_dir.path().to_path_buf()).await.unwrap();

        let blocks = vec![Block::new("Link to [[Target]]")];
        index.index_page("Source", &blocks).await.unwrap();
        assert_eq!(index.len(), 1);

        index.remove_page("Source").await.unwrap();
        assert_eq!(index.len(), 0);

        let backlinks = index.get_backlinks("Target");
        assert!(backlinks.is_empty());
    }

    #[tokio::test]
    async fn test_reindex_page_replaces_links() {
        let temp_dir = TempDir::new().unwrap();
        let mut index = LinkIndex::new(temp_dir.path().to_path_buf()).await.unwrap();

        // Initial index
        let blocks1 = vec![Block::new("Link to [[Old Target]]")];
        index.index_page("Source", &blocks1).await.unwrap();
        assert_eq!(index.len(), 1);
        assert_eq!(index.get_backlinks("Old Target").len(), 1);

        // Re-index with different links
        let blocks2 = vec![Block::new("Link to [[New Target]]")];
        index.index_page("Source", &blocks2).await.unwrap();

        // Should still have 1 link, but to new target
        assert_eq!(index.len(), 1);
        assert!(index.get_backlinks("Old Target").is_empty());
        assert_eq!(index.get_backlinks("New Target").len(), 1);
    }

    #[tokio::test]
    async fn test_persistence() {
        let temp_dir = TempDir::new().unwrap();

        // Create and populate index
        {
            let mut index = LinkIndex::new(temp_dir.path().to_path_buf()).await.unwrap();
            let blocks = vec![Block::new("Link to [[Target]]")];
            index.index_page("Source", &blocks).await.unwrap();
        }

        // Load index and verify
        {
            let index = LinkIndex::new(temp_dir.path().to_path_buf()).await.unwrap();
            assert_eq!(index.len(), 1);
            let backlinks = index.get_backlinks("Target");
            assert_eq!(backlinks.len(), 1);
        }
    }

    #[tokio::test]
    async fn test_rebuild_all() {
        let temp_dir = TempDir::new().unwrap();
        let mut index = LinkIndex::new(temp_dir.path().to_path_buf()).await.unwrap();

        let pages = vec![
            (
                "Page A".to_string(),
                vec![Block::new("Links to [[Page B]] and [[Page C]]")],
            ),
            (
                "Page B".to_string(),
                vec![Block::new("Links to [[Page A]]")],
            ),
        ];

        index.rebuild_all(pages.into_iter()).await.unwrap();

        assert_eq!(index.len(), 3);
        assert_eq!(index.get_backlinks("Page B").len(), 1);
        assert_eq!(index.get_backlinks("Page A").len(), 1);
        assert_eq!(index.get_backlinks("Page C").len(), 1);
    }

    #[tokio::test]
    async fn test_case_insensitive_backlinks() {
        let temp_dir = TempDir::new().unwrap();
        let mut index = LinkIndex::new(temp_dir.path().to_path_buf()).await.unwrap();

        let blocks = vec![Block::new("Link to [[My Page]]")];
        index.index_page("Source", &blocks).await.unwrap();

        // Should find backlinks regardless of case
        assert_eq!(index.get_backlinks("My Page").len(), 1);
        assert_eq!(index.get_backlinks("my page").len(), 1);
        assert_eq!(index.get_backlinks("MY PAGE").len(), 1);
    }

    #[tokio::test]
    async fn test_multiple_links_to_same_target() {
        let temp_dir = TempDir::new().unwrap();
        let mut index = LinkIndex::new(temp_dir.path().to_path_buf()).await.unwrap();

        let blocks = vec![
            Block::new("First link to [[Target]]"),
            Block::new("Second link to [[Target]]"),
        ];
        index.index_page("Source", &blocks).await.unwrap();

        let backlinks = index.get_backlinks("Target");
        assert_eq!(backlinks.len(), 2);
    }

    #[tokio::test]
    async fn test_get_wikilink_targets() {
        let temp_dir = TempDir::new().unwrap();
        let mut index = LinkIndex::new(temp_dir.path().to_path_buf()).await.unwrap();

        // Index multiple pages with various wikilinks
        let blocks1 = vec![Block::new("Link to [[Page A]] and [[Page B]]")];
        index.index_page("Source 1", &blocks1).await.unwrap();

        let blocks2 = vec![Block::new("Link to [[Page B]] and [[Page C]]")];
        index.index_page("Source 2", &blocks2).await.unwrap();

        // Get all unique wikilink targets
        let mut targets = index.get_wikilink_targets();
        targets.sort();

        assert_eq!(targets.len(), 3);
        assert_eq!(targets, vec!["Page A", "Page B", "Page C"]);
    }

    #[tokio::test]
    async fn test_get_wikilink_targets_excludes_tags() {
        let temp_dir = TempDir::new().unwrap();
        let mut index = LinkIndex::new(temp_dir.path().to_path_buf()).await.unwrap();

        // Index a page with both wikilinks and tags
        let blocks = vec![Block::new("Link to [[My Page]] with #tag and #another-tag")];
        index.index_page("Source", &blocks).await.unwrap();

        // Should only return wikilink targets, not tags
        let targets = index.get_wikilink_targets();
        assert_eq!(targets.len(), 1);
        assert!(targets.contains(&"My Page".to_string()));
    }
}
