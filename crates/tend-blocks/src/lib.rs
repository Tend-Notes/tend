// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Block reference index for efficient block lookups by UUID
//!
//! This crate provides a SQLite-based index that maps block UUIDs to their
//! containing pages. This enables the ((uuid)) block reference syntax.
//!
//! The index is stored at `.tend/blocks.db` within the garden directory.
//! For encrypted gardens, block references are disabled.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension};
use tend_core::Page;
use thiserror::Error;
use tracing::{debug, info};

/// Errors that can occur during block index operations
#[derive(Debug, Error)]
pub enum BlockError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Index not initialized")]
    NotInitialized,
}

/// Result type for block operations
pub type Result<T> = std::result::Result<T, BlockError>;

/// Information about a block's location
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlockRef {
    /// The block's UUID
    pub uuid: String,
    /// Name of the page containing this block
    pub page_name: String,
    /// Whether this block has children
    pub has_children: bool,
}

/// SQLite-based block reference index
///
/// Maps block UUIDs to their containing pages for efficient lookups.
/// Used to resolve ((uuid)) block reference syntax.
pub struct BlockIndex {
    /// Path to the database file
    db_path: PathBuf,
    /// Database connection
    conn: Connection,
}

impl BlockIndex {
    /// Create or open a block index at the given garden path
    ///
    /// The database will be created at `{garden_path}/.tend/blocks.db`
    pub fn new(garden_path: impl AsRef<Path>) -> Result<Self> {
        let garden_path = garden_path.as_ref();
        let tend_dir = garden_path.join(".tend");
        std::fs::create_dir_all(&tend_dir)?;

        let db_path = tend_dir.join("blocks.db");
        let conn = Connection::open(&db_path)?;

        let mut index = Self { db_path, conn };
        index.init_schema()?;

        info!("Block index opened at {}", index.db_path.display());
        Ok(index)
    }

    /// Initialize the database schema
    fn init_schema(&mut self) -> Result<()> {
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS blocks (
                uuid TEXT PRIMARY KEY,
                page_name TEXT NOT NULL,
                has_children INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_page ON blocks(page_name);
            ",
        )?;
        Ok(())
    }

    /// Update the index for a page
    ///
    /// Removes all existing entries for this page and inserts new ones
    /// for all blocks in the page.
    pub fn update_page(&mut self, page: &Page) -> Result<()> {
        let tx = self.conn.transaction()?;

        // Delete existing entries for this page
        tx.execute("DELETE FROM blocks WHERE page_name = ?1", [&page.name])?;

        // Insert new entries for all blocks
        let mut stmt = tx.prepare(
            "INSERT INTO blocks (uuid, page_name, has_children) VALUES (?1, ?2, ?3)",
        )?;

        for block in page.blocks.values() {
            let has_children = if block.children.is_empty() { 0 } else { 1 };
            stmt.execute((block.uuid.to_string(), &page.name, has_children))?;
        }

        drop(stmt);
        tx.commit()?;

        debug!(
            "Updated block index for page '{}': {} blocks",
            page.name,
            page.blocks.len()
        );
        Ok(())
    }

    /// Remove all blocks for a page from the index
    pub fn delete_page(&mut self, page_name: &str) -> Result<()> {
        let deleted = self
            .conn
            .execute("DELETE FROM blocks WHERE page_name = ?1", [page_name])?;

        debug!(
            "Removed {} blocks from index for page '{}'",
            deleted, page_name
        );
        Ok(())
    }

    /// Look up a block by UUID
    ///
    /// Returns `Some(BlockRef)` if found, `None` if not found.
    pub fn lookup(&self, uuid: &str) -> Result<Option<BlockRef>> {
        let result = self
            .conn
            .query_row(
                "SELECT uuid, page_name, has_children FROM blocks WHERE uuid = ?1",
                [uuid],
                |row| {
                    Ok(BlockRef {
                        uuid: row.get(0)?,
                        page_name: row.get(1)?,
                        has_children: row.get::<_, i32>(2)? != 0,
                    })
                },
            )
            .optional()?;

        Ok(result)
    }

    /// Rebuild the entire index from a collection of pages
    ///
    /// Clears the existing index and rebuilds from scratch.
    pub fn rebuild(&mut self, pages: impl Iterator<Item = Page>) -> Result<()> {
        info!("Rebuilding block index");

        let tx = self.conn.transaction()?;

        // Clear existing data
        tx.execute("DELETE FROM blocks", [])?;

        // Insert all blocks from all pages
        let mut stmt = tx.prepare(
            "INSERT INTO blocks (uuid, page_name, has_children) VALUES (?1, ?2, ?3)",
        )?;

        let mut page_count = 0;
        let mut block_count = 0;

        for page in pages {
            for block in page.blocks.values() {
                let has_children = if block.children.is_empty() { 0 } else { 1 };
                stmt.execute((block.uuid.to_string(), &page.name, has_children))?;
                block_count += 1;
            }
            page_count += 1;
        }

        drop(stmt);
        tx.commit()?;

        info!(
            "Block index rebuilt: {} blocks from {} pages",
            block_count, page_count
        );
        Ok(())
    }

    /// Get the total number of blocks in the index
    pub fn len(&self) -> Result<usize> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM blocks", [], |row| row.get(0))?;
        Ok(count as usize)
    }

    /// Check if the index is empty
    pub fn is_empty(&self) -> Result<bool> {
        Ok(self.len()? == 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use tend_core::Block;

    fn create_test_page(name: &str, block_contents: &[&str]) -> Page {
        let mut page = Page::new(name);
        for content in block_contents {
            page.add_block(Block::new(*content));
        }
        page
    }

    #[test]
    fn test_new_creates_database() {
        let temp_dir = TempDir::new().unwrap();
        let _index = BlockIndex::new(temp_dir.path()).unwrap();

        assert!(temp_dir.path().join(".tend").join("blocks.db").exists());
    }

    #[test]
    fn test_update_page_and_lookup() {
        let temp_dir = TempDir::new().unwrap();
        let mut index = BlockIndex::new(temp_dir.path()).unwrap();

        let page = create_test_page("Test Page", &["Block 1", "Block 2"]);
        let block_uuid = page.blocks.values().next().unwrap().uuid.to_string();

        index.update_page(&page).unwrap();

        let block_ref = index.lookup(&block_uuid).unwrap();
        assert!(block_ref.is_some());
        let block_ref = block_ref.unwrap();
        assert_eq!(block_ref.page_name, "Test Page");
        assert!(!block_ref.has_children);
    }

    #[test]
    fn test_lookup_not_found() {
        let temp_dir = TempDir::new().unwrap();
        let index = BlockIndex::new(temp_dir.path()).unwrap();

        let result = index.lookup("nonexistent-uuid").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_update_page_replaces_old_entries() {
        let temp_dir = TempDir::new().unwrap();
        let mut index = BlockIndex::new(temp_dir.path()).unwrap();

        // Initial page with 2 blocks
        let page1 = create_test_page("Test", &["Block 1", "Block 2"]);
        index.update_page(&page1).unwrap();
        assert_eq!(index.len().unwrap(), 2);

        // Update with different blocks
        let page2 = create_test_page("Test", &["New Block"]);
        index.update_page(&page2).unwrap();
        assert_eq!(index.len().unwrap(), 1);

        // Old blocks should be gone
        let old_uuid = page1.blocks.values().next().unwrap().uuid.to_string();
        assert!(index.lookup(&old_uuid).unwrap().is_none());

        // New block should be present
        let new_uuid = page2.blocks.values().next().unwrap().uuid.to_string();
        assert!(index.lookup(&new_uuid).unwrap().is_some());
    }

    #[test]
    fn test_delete_page() {
        let temp_dir = TempDir::new().unwrap();
        let mut index = BlockIndex::new(temp_dir.path()).unwrap();

        let page = create_test_page("Test", &["Block 1"]);
        let block_uuid = page.blocks.values().next().unwrap().uuid.to_string();

        index.update_page(&page).unwrap();
        assert!(index.lookup(&block_uuid).unwrap().is_some());

        index.delete_page("Test").unwrap();
        assert!(index.lookup(&block_uuid).unwrap().is_none());
        assert_eq!(index.len().unwrap(), 0);
    }

    #[test]
    fn test_rebuild() {
        let temp_dir = TempDir::new().unwrap();
        let mut index = BlockIndex::new(temp_dir.path()).unwrap();

        // Add some initial data
        let old_page = create_test_page("Old", &["Old Block"]);
        index.update_page(&old_page).unwrap();

        // Rebuild with new pages
        let pages = vec![
            create_test_page("Page A", &["A1", "A2"]),
            create_test_page("Page B", &["B1"]),
        ];

        index.rebuild(pages.into_iter()).unwrap();

        // Old data should be gone
        let old_uuid = old_page.blocks.values().next().unwrap().uuid.to_string();
        assert!(index.lookup(&old_uuid).unwrap().is_none());

        // New data should be present
        assert_eq!(index.len().unwrap(), 3);
    }

    #[test]
    fn test_has_children_tracking() {
        let temp_dir = TempDir::new().unwrap();
        let mut index = BlockIndex::new(temp_dir.path()).unwrap();

        let mut page = Page::new("Test");

        // Create parent with child
        let mut parent = Block::new("Parent");
        let child = Block::new("Child");
        parent.children.push(child.uuid);
        let parent_uuid = parent.uuid.to_string();
        let child_uuid = child.uuid.to_string();

        page.add_block(parent);
        page.add_block(child);

        index.update_page(&page).unwrap();

        let parent_ref = index.lookup(&parent_uuid).unwrap().unwrap();
        assert!(parent_ref.has_children);

        let child_ref = index.lookup(&child_uuid).unwrap().unwrap();
        assert!(!child_ref.has_children);
    }
}
