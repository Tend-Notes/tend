// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Block data model
//!
//! A Block is the fundamental unit in Tend. Every bullet point is a block.
//! Blocks have UUIDs for cross-referencing and can contain properties.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::LazyLock;
use uuid::Uuid;

/// A block represents a single bullet point in the outliner.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    /// Unique identifier for this block
    pub uuid: Uuid,

    /// The text content of this block (may contain markdown, wiki-links, etc.)
    pub content: String,

    /// UUID of the parent block (None for root-level blocks)
    pub parent_uuid: Option<Uuid>,

    /// Ordered list of child block UUIDs
    pub children: Vec<Uuid>,

    /// Whether this block is collapsed in the UI
    pub collapsed: bool,

    /// Key-value properties (e.g., "status:: TODO")
    pub properties: HashMap<String, String>,

    /// Indentation depth (0 for root level)
    pub depth: usize,
}

impl Block {
    /// Create a new block with the given content
    pub fn new(content: impl Into<String>) -> Self {
        Self {
            uuid: Uuid::new_v4(),
            content: content.into(),
            parent_uuid: None,
            children: Vec::new(),
            collapsed: false,
            properties: HashMap::new(),
            depth: 0,
        }
    }

    /// Create a new block with a specific UUID (for parsing existing files)
    pub fn with_uuid(uuid: Uuid, content: impl Into<String>) -> Self {
        Self {
            uuid,
            content: content.into(),
            parent_uuid: None,
            children: Vec::new(),
            collapsed: false,
            properties: HashMap::new(),
            depth: 0,
        }
    }

    /// Check if this block is a TODO item
    pub fn is_todo(&self) -> bool {
        let content = self.content.trim_start();
        content.starts_with("TODO ")
            || content.starts_with("DOING ")
            || content.starts_with("LATER ")
            || content.starts_with("NOW ")
            || content.starts_with("WAITING ")
    }

    /// Check if this block is marked as done
    pub fn is_done(&self) -> bool {
        let content = self.content.trim_start();
        content.starts_with("DONE ") || content.starts_with("CANCELLED ")
    }

    /// Get the task status if this is a task block
    pub fn task_status(&self) -> Option<TaskStatus> {
        let content = self.content.trim_start();
        if content.starts_with("TODO ") {
            Some(TaskStatus::Todo)
        } else if content.starts_with("DOING ") {
            Some(TaskStatus::Doing)
        } else if content.starts_with("DONE ") {
            Some(TaskStatus::Done)
        } else if content.starts_with("LATER ") {
            Some(TaskStatus::Later)
        } else if content.starts_with("NOW ") {
            Some(TaskStatus::Now)
        } else if content.starts_with("WAITING ") {
            Some(TaskStatus::Waiting)
        } else if content.starts_with("CANCELLED ") {
            Some(TaskStatus::Cancelled)
        } else {
            None
        }
    }

    /// Extract wiki-links from this block's content
    /// Returns page names like "Page Name" from [[Page Name]]
    pub fn extract_wiki_links(&self) -> Vec<String> {
        static WIKI_LINK_RE: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"\[\[([^\]]+)\]\]").unwrap());

        WIKI_LINK_RE
            .captures_iter(&self.content)
            .filter_map(|cap| cap.get(1).map(|m| m.as_str().to_string()))
            .collect()
    }

    /// Extract block references from this block's content
    /// Returns UUIDs from ((uuid)) syntax
    pub fn extract_block_refs(&self) -> Vec<Uuid> {
        static BLOCK_REF_RE: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"\(\(([a-f0-9-]+)\)\)").unwrap());

        BLOCK_REF_RE
            .captures_iter(&self.content)
            .filter_map(|cap| cap.get(1).and_then(|m| Uuid::parse_str(m.as_str()).ok()))
            .collect()
    }

    /// Extract hashtags from this block's content
    /// Returns tags like "project" from #project
    pub fn extract_tags(&self) -> Vec<String> {
        static TAG_RE: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"#([a-zA-Z][a-zA-Z0-9_-]*)").unwrap());

        TAG_RE
            .captures_iter(&self.content)
            .filter_map(|cap| cap.get(1).map(|m| m.as_str().to_string()))
            .collect()
    }

    /// Set a property on this block
    pub fn set_property(&mut self, key: impl Into<String>, value: impl Into<String>) {
        self.properties.insert(key.into(), value.into());
    }

    /// Get a property value
    pub fn get_property(&self, key: &str) -> Option<&String> {
        self.properties.get(key)
    }

    /// Check if block has any content (excluding whitespace)
    pub fn is_empty(&self) -> bool {
        self.content.trim().is_empty()
    }
}

impl Default for Block {
    fn default() -> Self {
        Self::new("")
    }
}

/// Task status for TODO blocks
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Todo,
    Doing,
    Done,
    Later,
    Now,
    Waiting,
    Cancelled,
}

impl std::fmt::Display for TaskStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TaskStatus::Todo => write!(f, "TODO"),
            TaskStatus::Doing => write!(f, "DOING"),
            TaskStatus::Done => write!(f, "DONE"),
            TaskStatus::Later => write!(f, "LATER"),
            TaskStatus::Now => write!(f, "NOW"),
            TaskStatus::Waiting => write!(f, "WAITING"),
            TaskStatus::Cancelled => write!(f, "CANCELLED"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_wiki_links() {
        let block = Block::new("Check out [[My Page]] and [[Another Page]]");
        let links = block.extract_wiki_links();
        assert_eq!(links, vec!["My Page", "Another Page"]);
    }

    #[test]
    fn test_extract_block_refs() {
        let uuid1 = Uuid::new_v4();
        let uuid2 = Uuid::new_v4();
        let block = Block::new(format!("Reference (({uuid1})) and (({uuid2}))"));
        let refs = block.extract_block_refs();
        assert_eq!(refs, vec![uuid1, uuid2]);
    }

    #[test]
    fn test_extract_tags() {
        let block = Block::new("This is #project and #important-task");
        let tags = block.extract_tags();
        assert_eq!(tags, vec!["project", "important-task"]);
    }

    #[test]
    fn test_task_status() {
        assert_eq!(Block::new("TODO Buy milk").task_status(), Some(TaskStatus::Todo));
        assert_eq!(Block::new("DOING Write code").task_status(), Some(TaskStatus::Doing));
        assert_eq!(Block::new("DONE Finished").task_status(), Some(TaskStatus::Done));
        assert_eq!(Block::new("Regular text").task_status(), None);
    }

    #[test]
    fn test_is_todo() {
        assert!(Block::new("TODO Task").is_todo());
        assert!(Block::new("DOING Task").is_todo());
        assert!(!Block::new("DONE Task").is_todo());
        assert!(!Block::new("Regular").is_todo());
    }
}
