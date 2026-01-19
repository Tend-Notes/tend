// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Page data model
//!
//! A Page represents a Markdown file in the garden. It contains a collection
//! of blocks organized in a tree structure.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

use crate::Block;

/// A page represents a single Markdown file in the garden.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    /// The page name (used as filename, without .md extension)
    pub name: String,

    /// Display title (may differ from name for journals)
    pub title: String,

    /// Root-level block UUIDs in order
    pub root_blocks: Vec<Uuid>,

    /// All blocks in this page, keyed by UUID
    pub blocks: HashMap<Uuid, Block>,

    /// Page-level properties (from first block if it only contains properties)
    pub properties: HashMap<String, String>,

    /// Whether this is a journal page
    pub is_journal: bool,

    /// Journal date (if this is a journal page)
    pub journal_date: Option<NaiveDate>,

    /// File creation timestamp
    pub created_at: DateTime<Utc>,

    /// File modification timestamp
    pub modified_at: DateTime<Utc>,

    /// Version number for conflict detection (increments on each save)
    #[serde(default = "default_version")]
    pub version: u64,
}

fn default_version() -> u64 {
    1
}

impl Page {
    /// Create a new empty page
    pub fn new(name: impl Into<String>) -> Self {
        let name = name.into();
        let now = Utc::now();
        Self {
            title: name.clone(),
            name,
            root_blocks: Vec::new(),
            blocks: HashMap::new(),
            properties: HashMap::new(),
            is_journal: false,
            journal_date: None,
            created_at: now,
            modified_at: now,
            version: 1,
        }
    }

    /// Create a new journal page for a specific date
    pub fn new_journal(date: NaiveDate) -> Self {
        let name = date.format("%Y-%m-%d").to_string();
        // Human-readable title like "Saturday, January 18, 2025"
        let title = date.format("%A, %B %-d, %Y").to_string();
        let now = Utc::now();

        Self {
            name,
            title,
            root_blocks: Vec::new(),
            blocks: HashMap::new(),
            properties: HashMap::new(),
            is_journal: true,
            journal_date: Some(date),
            created_at: now,
            modified_at: now,
            version: 1,
        }
    }

    /// Add a block to this page
    pub fn add_block(&mut self, block: Block) {
        let uuid = block.uuid;
        if block.parent_uuid.is_none() {
            self.root_blocks.push(uuid);
        }
        self.blocks.insert(uuid, block);
    }

    /// Get a block by UUID
    pub fn get_block(&self, uuid: &Uuid) -> Option<&Block> {
        self.blocks.get(uuid)
    }

    /// Get a mutable reference to a block
    pub fn get_block_mut(&mut self, uuid: &Uuid) -> Option<&mut Block> {
        self.blocks.get_mut(uuid)
    }

    /// Get all blocks in tree order (depth-first)
    pub fn blocks_in_order(&self) -> Vec<&Block> {
        let mut result = Vec::new();
        for root_uuid in &self.root_blocks {
            self.collect_blocks_recursive(root_uuid, &mut result);
        }
        result
    }

    fn collect_blocks_recursive<'a>(&'a self, uuid: &Uuid, result: &mut Vec<&'a Block>) {
        if let Some(block) = self.blocks.get(uuid) {
            result.push(block);
            for child_uuid in &block.children {
                self.collect_blocks_recursive(child_uuid, result);
            }
        }
    }

    /// Get all wiki-links in this page
    pub fn all_wiki_links(&self) -> Vec<String> {
        let mut links = Vec::new();
        for block in self.blocks.values() {
            links.extend(block.extract_wiki_links());
        }
        // Deduplicate
        links.sort();
        links.dedup();
        links
    }

    /// Get all block references in this page
    pub fn all_block_refs(&self) -> Vec<Uuid> {
        let mut refs = Vec::new();
        for block in self.blocks.values() {
            refs.extend(block.extract_block_refs());
        }
        // Deduplicate
        refs.sort();
        refs.dedup();
        refs
    }

    /// Get all tags in this page
    pub fn all_tags(&self) -> Vec<String> {
        let mut tags = Vec::new();
        for block in self.blocks.values() {
            tags.extend(block.extract_tags());
        }
        // Deduplicate
        tags.sort();
        tags.dedup();
        tags
    }

    /// Check if this page is empty (no blocks or only empty blocks)
    pub fn is_empty(&self) -> bool {
        self.blocks.is_empty() || self.blocks.values().all(|b| b.is_empty())
    }

    /// Update the modified timestamp
    pub fn touch(&mut self) {
        self.modified_at = Utc::now();
    }
}

/// Metadata about a page (without full block content)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageMeta {
    pub name: String,
    pub title: String,
    pub is_journal: bool,
    pub journal_date: Option<NaiveDate>,
    pub block_count: usize,
    pub created_at: DateTime<Utc>,
    pub modified_at: DateTime<Utc>,
}

impl From<&Page> for PageMeta {
    fn from(page: &Page) -> Self {
        Self {
            name: page.name.clone(),
            title: page.title.clone(),
            is_journal: page.is_journal,
            journal_date: page.journal_date,
            block_count: page.blocks.len(),
            created_at: page.created_at,
            modified_at: page.modified_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_journal() {
        let date = NaiveDate::from_ymd_opt(2025, 1, 18).unwrap();
        let page = Page::new_journal(date);

        assert_eq!(page.name, "2025-01-18");
        assert_eq!(page.title, "Saturday, January 18, 2025");
        assert!(page.is_journal);
        assert_eq!(page.journal_date, Some(date));
    }

    #[test]
    fn test_add_and_get_block() {
        let mut page = Page::new("Test");
        let block = Block::new("Hello world");
        let uuid = block.uuid;

        page.add_block(block);

        assert!(page.get_block(&uuid).is_some());
        assert_eq!(page.get_block(&uuid).unwrap().content, "Hello world");
    }

    #[test]
    fn test_all_wiki_links() {
        let mut page = Page::new("Test");
        page.add_block(Block::new("Link to [[Page A]]"));
        page.add_block(Block::new("Link to [[Page B]] and [[Page A]]"));

        let links = page.all_wiki_links();
        assert_eq!(links, vec!["Page A", "Page B"]);
    }
}
