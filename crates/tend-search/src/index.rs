// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Search index management

use std::path::Path;
use std::time::SystemTime;

use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::Value;
use tantivy::{doc, Index, IndexReader, IndexWriter, ReloadPolicy, Term};
use tend_core::Page;
use tracing::{debug, info};

use crate::error::SearchError;
use crate::schema::create_schema;

/// Information about an existing search index
#[derive(Debug, Clone)]
pub struct IndexInfo {
    /// Number of documents in the index
    pub num_docs: u64,
    /// Last modification time of the index directory
    pub modified_at: Option<SystemTime>,
}

/// Check if a valid index exists at the given path without opening it fully
pub fn index_exists(index_path: &Path) -> bool {
    index_path.exists() && index_path.join("meta.json").exists()
}

/// Get information about an existing index
pub fn get_index_info(index_path: &Path) -> Option<IndexInfo> {
    if !index_exists(index_path) {
        return None;
    }

    // Get modification time from meta.json
    let meta_path = index_path.join("meta.json");
    let modified_at = std::fs::metadata(&meta_path)
        .ok()
        .and_then(|m| m.modified().ok());

    // Try to open and get doc count
    let index = Index::open_in_dir(index_path).ok()?;
    let reader = index
        .reader_builder()
        .reload_policy(ReloadPolicy::Manual)
        .try_into()
        .ok()?;

    Some(IndexInfo {
        num_docs: reader.searcher().num_docs(),
        modified_at,
    })
}

/// Search result item
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub uuid: String,
    pub content: String,
    pub page_name: String,
    pub page_title: String,
    pub is_journal: bool,
    pub score: f32,
}

/// Commit the writer after this many buffered document changes, so a burst of
/// saves fsyncs once instead of once per save.
const COMMIT_PENDING_THRESHOLD: usize = 32;

/// Commit at least this often when there are buffered changes, bounding how long
/// a just-saved doc stays uncommitted (it's still searchable via commit-before-
/// query; this bounds durability/crash-drift of the derived index).
const COMMIT_INTERVAL: std::time::Duration = std::time::Duration::from_secs(5);

/// Manages the Tantivy search index
pub struct SearchIndex {
    index: Index,
    reader: IndexReader,
    writer: IndexWriter,
    /// Uncommitted document changes buffered in the writer.
    pending: usize,
    /// When the writer was last committed, for time-based commit batching.
    last_commit: std::time::Instant,
}

impl SearchIndex {
    /// Create or open an index at the given path
    pub fn open(index_path: &Path) -> Result<Self, SearchError> {
        let schema = create_schema();

        let index = if index_path.exists() && index_path.join("meta.json").exists() {
            info!("Opening existing index at: {}", index_path.display());
            Index::open_in_dir(index_path)?
        } else {
            info!("Creating new index at: {}", index_path.display());
            std::fs::create_dir_all(index_path)?;
            // Owner-only: the search index holds page content in plaintext.
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(index_path, std::fs::Permissions::from_mode(0o700));
            }
            Index::create_in_dir(index_path, schema)?
        };

        // 50MB writer heap
        let writer = index.writer(50_000_000)?;

        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::OnCommitWithDelay)
            .try_into()?;

        Ok(Self {
            index,
            reader,
            writer,
            pending: 0,
            last_commit: std::time::Instant::now(),
        })
    }

    /// Create an in-memory index (for testing)
    pub fn in_memory() -> Result<Self, SearchError> {
        let schema = create_schema();
        let index = Index::create_in_ram(schema);
        let writer = index.writer(50_000_000)?;
        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::OnCommitWithDelay)
            .try_into()?;

        Ok(Self {
            index,
            reader,
            writer,
            pending: 0,
            last_commit: std::time::Instant::now(),
        })
    }

    /// Index a page (removes old entries and adds new ones)
    pub fn index_page(&mut self, page: &Page) -> Result<(), SearchError> {
        let schema = self.index.schema();
        let page_name_field = schema.get_field("page_name").unwrap();

        // Delete existing documents for this page
        let term = Term::from_field_text(page_name_field, &page.name);
        self.writer.delete_term(term);

        // Add new documents for each block
        let uuid_field = schema.get_field("uuid").unwrap();
        let content_field = schema.get_field("content").unwrap();
        let page_title_field = schema.get_field("page_title").unwrap();
        let is_journal_field = schema.get_field("is_journal").unwrap();

        for block in page.blocks.values() {
            // Skip empty blocks
            if block.content.trim().is_empty() {
                continue;
            }

            self.writer.add_document(doc!(
                uuid_field => block.uuid.to_string(),
                content_field => block.content.clone(),
                page_name_field => page.name.clone(),
                page_title_field => page.title.clone(),
                is_journal_field => if page.is_journal { "true" } else { "false" },
            ))?;
        }

        debug!("Indexed {} blocks for page: {}", page.blocks.len(), page.name);

        self.pending += 1;
        Ok(())
    }

    /// Remove all documents from the index
    ///
    /// This uses the existing writer to clear the index without releasing the
    /// lock, so it is safe to call while the server is running.
    pub fn clear(&mut self) -> Result<(), SearchError> {
        self.writer.delete_all_documents()?;
        Ok(())
    }

    /// Remove a page from the index
    pub fn remove_page(&mut self, page_name: &str) -> Result<(), SearchError> {
        let schema = self.index.schema();
        let page_name_field = schema.get_field("page_name").unwrap();

        let term = Term::from_field_text(page_name_field, page_name);
        self.writer.delete_term(term);

        debug!("Removed page from index: {}", page_name);

        self.pending += 1;
        Ok(())
    }

    /// Commit changes to the index (durable fsync + reader reload).
    pub fn commit(&mut self) -> Result<(), SearchError> {
        self.writer.commit()?;
        // Reload the reader to see the new changes
        self.reader.reload()?;
        self.pending = 0;
        self.last_commit = std::time::Instant::now();
        Ok(())
    }

    /// Commit only if there are uncommitted changes. Called before a search so
    /// results always reflect the latest saves despite deferred commits.
    pub fn commit_if_dirty(&mut self) -> Result<(), SearchError> {
        if self.pending > 0 {
            self.commit()?;
        }
        Ok(())
    }

    /// Commit if enough documents have buffered or enough time has elapsed since
    /// the last commit; otherwise defer. This batches a burst of saves into a
    /// single fsync instead of one fsync per save.
    pub fn maybe_commit(&mut self) -> Result<(), SearchError> {
        if self.pending >= COMMIT_PENDING_THRESHOLD
            || (self.pending > 0 && self.last_commit.elapsed() >= COMMIT_INTERVAL)
        {
            self.commit()?;
        }
        Ok(())
    }

    /// Search for blocks matching the query
    pub fn search(&self, query_str: &str, limit: usize) -> Result<Vec<SearchResult>, SearchError> {
        // Bound the limit: TopDocs::with_limit(0) panics, and a huge value forces
        // a large allocation. Clamp to a sane 1..=200.
        let limit = limit.clamp(1, 200);

        let schema = self.index.schema();
        let content_field = schema.get_field("content").unwrap();
        let page_title_field = schema.get_field("page_title").unwrap();

        // Create query parser searching both content and page title
        let query_parser = QueryParser::for_index(&self.index, vec![content_field, page_title_field]);
        let query = query_parser.parse_query(query_str)?;

        let searcher = self.reader.searcher();
        let top_docs = searcher.search(&query, &TopDocs::with_limit(limit))?;

        let uuid_field = schema.get_field("uuid").unwrap();
        let page_name_field = schema.get_field("page_name").unwrap();
        let is_journal_field = schema.get_field("is_journal").unwrap();

        let mut results = Vec::new();

        for (score, doc_address) in top_docs {
            let retrieved_doc = searcher.doc::<tantivy::TantivyDocument>(doc_address)?;

            let uuid = retrieved_doc
                .get_first(uuid_field)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let content = retrieved_doc
                .get_first(content_field)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let page_name = retrieved_doc
                .get_first(page_name_field)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let page_title = retrieved_doc
                .get_first(page_title_field)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let is_journal = retrieved_doc
                .get_first(is_journal_field)
                .and_then(|v| v.as_str())
                .unwrap_or("false")
                == "true";

            results.push(SearchResult {
                uuid,
                content,
                page_name,
                page_title,
                is_journal,
                score,
            });
        }

        Ok(results)
    }

    /// Get the number of documents in the index
    pub fn num_docs(&self) -> u64 {
        self.reader.searcher().num_docs()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tend_core::Block;

    #[test]
    fn test_index_and_search() {
        let mut index = SearchIndex::in_memory().unwrap();

        let mut page = Page::new("Test Page");
        page.add_block(Block::new("Hello world, this is a test"));
        page.add_block(Block::new("Another block with different content"));

        index.index_page(&page).unwrap();
        index.commit().unwrap();

        let results = index.search("hello", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].content.contains("Hello"));
    }

    #[test]
    fn maybe_commit_batches_saves_and_query_flushes() {
        let mut index = SearchIndex::in_memory().unwrap();

        // A burst of saves within the batching window commits nothing (each
        // maybe_commit defers: < COMMIT_PENDING_THRESHOLD and < COMMIT_INTERVAL).
        for i in 0..10 {
            let mut page = Page::new(format!("Page {i}"));
            page.add_block(Block::new("hello world"));
            index.index_page(&page).unwrap();
            index.maybe_commit().unwrap();
        }
        assert_eq!(index.pending, 10, "10 saves buffered, none committed");
        // Uncommitted -> not yet searchable.
        assert_eq!(index.search("hello", 20).unwrap().len(), 0);

        // Commit-before-query flushes the buffered saves in one commit.
        index.commit_if_dirty().unwrap();
        assert_eq!(index.pending, 0);
        assert_eq!(index.search("hello", 20).unwrap().len(), 10);
    }

    #[test]
    fn maybe_commit_flushes_when_threshold_reached() {
        let mut index = SearchIndex::in_memory().unwrap();
        for i in 0..COMMIT_PENDING_THRESHOLD {
            let mut page = Page::new(format!("P{i}"));
            page.add_block(Block::new("threshold content"));
            index.index_page(&page).unwrap();
            index.maybe_commit().unwrap();
        }
        // Hitting the pending threshold commits automatically.
        assert_eq!(index.pending, 0, "threshold reached -> auto-committed");
        assert_eq!(index.search("threshold", 100).unwrap().len(), COMMIT_PENDING_THRESHOLD);
    }

    #[test]
    fn test_search_limit_is_bounded() {
        let mut index = SearchIndex::in_memory().unwrap();
        let mut page = Page::new("Test Page");
        page.add_block(Block::new("hello world"));
        index.index_page(&page).unwrap();
        index.commit().unwrap();

        // limit=0 must not panic (TopDocs::with_limit(0) would); a huge value is
        // clamped rather than allocating unboundedly.
        assert!(index.search("hello", 0).is_ok());
        assert!(index.search("hello", usize::MAX).is_ok());
    }

    #[test]
    fn test_remove_page() {
        let mut index = SearchIndex::in_memory().unwrap();

        let mut page = Page::new("Test Page");
        page.add_block(Block::new("Some content"));

        index.index_page(&page).unwrap();
        index.commit().unwrap();

        assert_eq!(index.num_docs(), 1);

        index.remove_page("Test Page").unwrap();
        index.commit().unwrap();

        assert_eq!(index.num_docs(), 0);
    }

    #[test]
    fn test_reindex_page() {
        let mut index = SearchIndex::in_memory().unwrap();

        let mut page = Page::new("Test Page");
        page.add_block(Block::new("Original content"));

        index.index_page(&page).unwrap();
        index.commit().unwrap();

        // Modify and reindex
        page.blocks.clear();
        page.root_blocks.clear();
        page.add_block(Block::new("Updated content"));

        index.index_page(&page).unwrap();
        index.commit().unwrap();

        // Should only have 1 document
        assert_eq!(index.num_docs(), 1);

        // Should find updated content
        let results = index.search("updated", 10).unwrap();
        assert_eq!(results.len(), 1);
    }
}
