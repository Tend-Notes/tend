// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Page data model
//!
//! A Page represents a Markdown file in the garden. It contains a collection
//! of blocks organized in a tree structure.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

use crate::{Block, BlockData, CoreError};

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

    /// Content type ID (e.g., "page", "journal", "meeting")
    /// All pages belong to a content type - pages and journals are built-in types.
    #[serde(default = "default_content_type")]
    pub content_type: String,

    /// Whether this is a journal page (derived from content_type == "journal")
    pub is_journal: bool,

    /// Journal date (for journals) or sheet date (for saveByDate content types)
    pub journal_date: Option<NaiveDate>,

    /// File creation timestamp
    pub created_at: DateTime<Utc>,

    /// File modification timestamp
    pub modified_at: DateTime<Utc>,

    /// Version number for conflict detection (increments on each save)
    #[serde(default = "default_version")]
    pub version: u64,
}

fn default_content_type() -> String {
    "page".to_string()
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
            content_type: "page".to_string(),
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
            content_type: "journal".to_string(),
            is_journal: true,
            journal_date: Some(date),
            created_at: now,
            modified_at: now,
            version: 1,
        }
    }

    /// Create a new sheet for a custom content type
    pub fn new_sheet(name: impl Into<String>, content_type_id: impl Into<String>, date: Option<NaiveDate>) -> Self {
        let name = name.into();
        let content_type_id = content_type_id.into();
        let now = Utc::now();
        Self {
            title: name.clone(),
            name,
            root_blocks: Vec::new(),
            blocks: HashMap::new(),
            properties: HashMap::new(),
            content_type: content_type_id,
            is_journal: false,
            journal_date: date,
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

    /// Check if this page is empty (no blocks or only empty blocks)
    pub fn is_empty(&self) -> bool {
        self.blocks.is_empty() || self.blocks.values().all(|b| b.is_empty())
    }

    /// Update the modified timestamp
    pub fn touch(&mut self) {
        self.modified_at = Utc::now();
    }

    /// Optimistic-concurrency check: fail if the client's `expected` version is
    /// not the one this page is at. `None` means the client did not ask for the
    /// check.
    pub fn check_version(&self, expected: Option<u64>) -> Result<(), CoreError> {
        match expected {
            Some(expected) if self.version != expected => Err(CoreError::VersionConflict {
                expected,
                current: self.version,
            }),
            _ => Ok(()),
        }
    }

    /// Replace this page's blocks with the ones a client sent, bumping the
    /// version and the modified timestamp.
    ///
    /// The whole block set is replaced, not merged: a save sends the page as it
    /// now stands. `expected_version` runs [`Self::check_version`] first, so a
    /// conflict leaves the page untouched.
    pub fn apply_block_updates(
        &mut self,
        blocks: Vec<BlockData>,
        expected_version: Option<u64>,
    ) -> Result<(), CoreError> {
        self.check_version(expected_version)?;

        // Parse every UUID before mutating, so a bad one does not leave the
        // page half-replaced.
        let mut parsed = Vec::with_capacity(blocks.len());
        for data in blocks {
            let uuid: Uuid = data
                .uuid
                .parse()
                .map_err(|_| CoreError::InvalidUuid(data.uuid.clone()))?;
            parsed.push((uuid, data));
        }

        self.blocks.clear();
        self.root_blocks.clear();

        for (uuid, data) in parsed {
            let mut block = Block::with_uuid(uuid, &data.content);
            block.parent_uuid = data.parent_uuid.as_ref().and_then(|s| s.parse().ok());
            block.children = data.children.iter().filter_map(|s| s.parse().ok()).collect();
            block.collapsed = data.collapsed;
            block.properties = data.properties;
            self.add_block(block);
        }

        self.version += 1;
        self.touch();

        Ok(())
    }

    /// Merge page-level property changes.
    ///
    /// `Some(v)` sets the key, `None` removes it. Keys absent from `properties`
    /// are left alone, so properties the server sets (`readonly`, say) survive a
    /// client that does not echo them back.
    pub fn apply_property_updates(&mut self, properties: HashMap<String, Option<String>>) {
        for (key, value) in properties {
            match value {
                Some(v) => {
                    self.properties.insert(key, v);
                }
                None => {
                    self.properties.remove(&key);
                }
            }
        }
    }
}

/// Metadata about a page (without full block content)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageMeta {
    pub name: String,
    pub title: String,
    /// Content type ID (e.g., "page", "journal", "meeting")
    #[serde(default = "default_content_type")]
    pub content_type: String,
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
            content_type: page.content_type.clone(),
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

    fn block_data(uuid: Uuid, content: &str, parent: Option<Uuid>, children: &[Uuid]) -> BlockData {
        BlockData {
            uuid: uuid.to_string(),
            content: content.to_string(),
            parent_uuid: parent.map(|u| u.to_string()),
            children: children.iter().map(|u| u.to_string()).collect(),
            collapsed: false,
            properties: HashMap::new(),
        }
    }

    #[test]
    fn check_version_table() {
        let mut page = Page::new("Test");
        page.version = 7;
        assert!(page.check_version(None).is_ok(), "no expectation, no check");
        assert!(page.check_version(Some(7)).is_ok(), "matching version passes");
        match page.check_version(Some(6)) {
            Err(CoreError::VersionConflict { expected, current }) => {
                assert_eq!((expected, current), (6, 7));
            }
            other => panic!("expected a version conflict, got {other:?}"),
        }
    }

    #[test]
    fn apply_block_updates_replaces_the_block_set() {
        let mut page = Page::new("Test");
        page.add_block(Block::new("old"));
        assert_eq!(page.blocks.len(), 1);

        let parent = Uuid::new_v4();
        let child = Uuid::new_v4();
        page.apply_block_updates(
            vec![
                block_data(parent, "parent", None, &[child]),
                block_data(child, "child", Some(parent), &[]),
            ],
            None,
        )
        .unwrap();

        assert_eq!(page.blocks.len(), 2);
        assert_eq!(page.root_blocks, vec![parent], "only the parent is a root");
        assert_eq!(page.blocks[&parent].children, vec![child]);
        assert_eq!(page.blocks[&child].parent_uuid, Some(parent));
        assert_eq!(page.version, 2, "a save bumps the version");
    }

    #[test]
    fn apply_block_updates_refuses_a_stale_version() {
        let mut page = Page::new("Test");
        page.add_block(Block::new("old"));
        let err = page
            .apply_block_updates(vec![block_data(Uuid::new_v4(), "new", None, &[])], Some(99))
            .unwrap_err();
        assert!(matches!(err, CoreError::VersionConflict { .. }));
        assert_eq!(page.blocks.len(), 1, "a conflict leaves the page untouched");
        assert_eq!(page.version, 1);
    }

    #[test]
    fn apply_block_updates_rejects_an_unparseable_uuid() {
        let mut page = Page::new("Test");
        page.add_block(Block::new("old"));
        let bad = BlockData {
            uuid: "not-a-uuid".to_string(),
            content: "new".to_string(),
            parent_uuid: None,
            children: Vec::new(),
            collapsed: false,
            properties: HashMap::new(),
        };
        let err = page.apply_block_updates(vec![bad], None).unwrap_err();
        assert!(matches!(err, CoreError::InvalidUuid(_)));
        assert_eq!(page.blocks.len(), 1, "nothing is replaced on a bad UUID");
    }

    #[test]
    fn apply_property_updates_sets_removes_and_leaves_alone() {
        let mut page = Page::new("Test");
        page.properties.insert("readonly".to_string(), "true".to_string());
        page.properties.insert("longform".to_string(), "true".to_string());

        let mut changes = HashMap::new();
        changes.insert("longform".to_string(), None); // remove
        changes.insert("pinned".to_string(), Some("yes".to_string())); // set
        page.apply_property_updates(changes);

        assert_eq!(page.properties.get("pinned"), Some(&"yes".to_string()));
        assert!(!page.properties.contains_key("longform"));
        assert_eq!(
            page.properties.get("readonly"),
            Some(&"true".to_string()),
            "a key the client never mentioned survives"
        );
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
