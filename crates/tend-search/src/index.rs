// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Search index management

use std::path::Path;

use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::Value;
use tantivy::{doc, Index, IndexReader, IndexWriter, ReloadPolicy, Term};
use tend_core::Page;
use tracing::{debug, info};

use crate::error::SearchError;
use crate::schema::create_schema;

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

/// Manages the Tantivy search index
pub struct SearchIndex {
    index: Index,
    reader: IndexReader,
    writer: IndexWriter,
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
            Index::create_in_dir(index_path, schema)?
        };

        // 50MB writer heap - if this fails due to lock, try to recover
        let writer = match index.writer(50_000_000) {
            Ok(w) => w,
            Err(e) => {
                // Check if it's a lock error
                let err_str = e.to_string();
                if err_str.contains("LockBusy") || err_str.contains("Lockfile") {
                    // Try to remove the stale lock file and retry
                    let lock_path = index_path.join(".tantivy-writer.lock");
                    if lock_path.exists() {
                        info!("Attempting to remove stale lock file: {}", lock_path.display());
                        if let Err(remove_err) = std::fs::remove_file(&lock_path) {
                            debug!("Failed to remove lock file: {}", remove_err);
                            return Err(e.into());
                        }
                        // Retry creating the writer
                        index.writer(50_000_000)?
                    } else {
                        return Err(e.into());
                    }
                } else {
                    return Err(e.into());
                }
            }
        };

        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::OnCommitWithDelay)
            .try_into()?;

        Ok(Self {
            index,
            reader,
            writer,
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

        Ok(())
    }

    /// Remove a page from the index
    pub fn remove_page(&mut self, page_name: &str) -> Result<(), SearchError> {
        let schema = self.index.schema();
        let page_name_field = schema.get_field("page_name").unwrap();

        let term = Term::from_field_text(page_name_field, page_name);
        self.writer.delete_term(term);

        debug!("Removed page from index: {}", page_name);

        Ok(())
    }

    /// Commit changes to the index
    pub fn commit(&mut self) -> Result<(), SearchError> {
        self.writer.commit()?;
        Ok(())
    }

    /// Search for blocks matching the query
    pub fn search(&self, query_str: &str, limit: usize) -> Result<Vec<SearchResult>, SearchError> {
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
