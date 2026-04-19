// SPDX-License-Identifier: MIT WITH Commons-Clause
//! In-memory indices for tags and todos
//!
//! These indices are populated on garden load and updated incrementally
//! when pages are saved, avoiding full scans on every API request.

use chrono::NaiveDate;
use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::LazyLock;
use tend_core::{ContentType, Page};
use uuid::Uuid;

// ============================================================================
// Tag Index
// ============================================================================

/// Tag occurrence in a specific block
#[derive(Debug, Clone)]
pub struct TagOccurrence {
    /// The page where this tag appears
    pub page_name: String,
    /// The block UUID where this tag appears
    pub block_uuid: Uuid,
}

/// In-memory index mapping tags to their occurrences
#[derive(Debug, Default)]
pub struct TagIndex {
    /// Map from tag name (lowercase) to list of occurrences
    tags: HashMap<String, Vec<TagOccurrence>>,
    /// Map from page name to set of tags in that page (for efficient removal)
    page_tags: HashMap<String, Vec<String>>,
}

impl TagIndex {
    /// Create an empty tag index
    pub fn new() -> Self {
        Self::default()
    }

    /// Index a page, extracting all tags from its blocks
    ///
    /// This removes any existing tags from this page before adding new ones.
    pub fn index_page(&mut self, page: &Page) {
        // Remove existing tags for this page
        self.remove_page(&page.name);

        // Extract tags from all blocks
        let mut page_tag_list = Vec::new();

        for block in page.blocks.values() {
            for tag in block.extract_tags() {
                let tag_lower = tag.to_lowercase();
                page_tag_list.push(tag_lower.clone());

                self.tags
                    .entry(tag_lower)
                    .or_default()
                    .push(TagOccurrence {
                        page_name: page.name.clone(),
                        block_uuid: block.uuid,
                    });
            }
        }

        if !page_tag_list.is_empty() {
            self.page_tags.insert(page.name.clone(), page_tag_list);
        }
    }

    /// Remove all tags from a specific page
    pub fn remove_page(&mut self, page_name: &str) {
        if let Some(tags) = self.page_tags.remove(page_name) {
            for tag in tags {
                if let Some(occurrences) = self.tags.get_mut(&tag) {
                    occurrences.retain(|o| o.page_name != page_name);
                    // Remove empty entries
                    if occurrences.is_empty() {
                        self.tags.remove(&tag);
                    }
                }
            }
        }
    }

    /// Get all tags with their counts, sorted by name
    pub fn get_all_tags(&self) -> Vec<TagInfo> {
        let mut tags: Vec<TagInfo> = self
            .tags
            .iter()
            .map(|(name, occurrences)| TagInfo {
                name: name.clone(),
                count: occurrences.len(),
            })
            .collect();

        tags.sort_by_key(|a| a.name.to_lowercase());
        tags
    }

    /// Get the number of unique tags
    pub fn len(&self) -> usize {
        self.tags.len()
    }

    /// Check if index is empty
    pub fn is_empty(&self) -> bool {
        self.tags.is_empty()
    }

    /// Clear the entire index
    pub fn clear(&mut self) {
        self.tags.clear();
        self.page_tags.clear();
    }
}

/// Tag info with usage count (for API response)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagInfo {
    pub name: String,
    pub count: usize,
}

// ============================================================================
// Todo Index
// ============================================================================

/// Task status keywords to look for
static STATUS_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(TODO|DOING|DONE|NOW|LATER|NEVER)(?:\s+(.*))?$").expect("Invalid regex")
});

/// A task item stored in the index
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskItem {
    /// The block UUID
    pub uuid: String,
    /// The task status keyword (TODO, DOING, DONE, etc.)
    pub status: String,
    /// The block content (after the status keyword)
    pub content: String,
    /// The page name where this task is located
    pub page_name: String,
    /// The page title
    pub page_title: String,
    /// Content type ID (e.g., "page", "journal", "meetings")
    pub content_type: String,
    /// Whether the page is a journal
    pub is_journal: bool,
    /// Journal date if applicable
    pub journal_date: Option<String>,
    /// Due date (YYYY-MM-DD format)
    pub due_date: Option<String>,
    /// Start date (YYYY-MM-DD format)
    pub start_date: Option<String>,
    /// Priority level (1, 2, or 3)
    pub priority: Option<String>,
}

/// Key for identifying a page in the todo index
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PageKey {
    pub content_type: String,
    pub name: String,
    pub date: Option<NaiveDate>,
}

impl PageKey {
    pub fn new(content_type: &str, name: &str, date: Option<NaiveDate>) -> Self {
        Self {
            content_type: content_type.to_string(),
            name: name.to_string(),
            date,
        }
    }

    pub fn page(name: &str) -> Self {
        Self::new("page", name, None)
    }

    pub fn journal(date: NaiveDate) -> Self {
        Self::new("journal", &date.to_string(), Some(date))
    }

    pub fn sheet(content_type: &str, name: &str, date: Option<NaiveDate>) -> Self {
        Self::new(content_type, name, date)
    }
}

/// In-memory index of all todos across the garden
#[derive(Debug, Default)]
pub struct TodoIndex {
    /// Map from page key to list of tasks in that page
    tasks: HashMap<PageKey, Vec<TaskItem>>,
}

impl TodoIndex {
    /// Create an empty todo index
    pub fn new() -> Self {
        Self::default()
    }

    /// Index a page, extracting all todos from its blocks
    ///
    /// This removes any existing todos from this page before adding new ones.
    pub fn index_page(&mut self, page: &Page, content_type: &ContentType, date: Option<NaiveDate>) {
        let key = PageKey::new(&content_type.id, &page.name, date);
        self.index_page_with_key(page, key, content_type, date);
    }

    /// Index a regular page (content type = "page")
    pub fn index_regular_page(&mut self, page: &Page) {
        let key = PageKey::page(&page.name);
        self.index_page_with_key(page, key, &ContentType::page(), None);
    }

    /// Index a journal page
    pub fn index_journal(&mut self, page: &Page, date: NaiveDate) {
        let key = PageKey::journal(date);
        self.index_page_with_key(page, key, &ContentType::journal(), Some(date));
    }

    /// Index a sheet (custom content type)
    pub fn index_sheet(&mut self, page: &Page, content_type: &ContentType, date: Option<NaiveDate>) {
        let key = PageKey::sheet(&content_type.id, &page.name, date);
        self.index_page_with_key(page, key, content_type, date);
    }

    /// Internal method to index with a specific key
    fn index_page_with_key(
        &mut self,
        page: &Page,
        key: PageKey,
        content_type: &ContentType,
        date: Option<NaiveDate>,
    ) {
        // Remove existing todos for this page
        self.tasks.remove(&key);

        // Extract todos from all blocks
        let mut page_tasks = Vec::new();

        for block in page.blocks.values() {
            if let Some(captures) = STATUS_PATTERN.captures(&block.content) {
                let status = captures.get(1).unwrap().as_str().to_string();
                let content = captures
                    .get(2)
                    .map(|m| m.as_str())
                    .unwrap_or("")
                    .to_string();

                page_tasks.push(TaskItem {
                    uuid: block.uuid.to_string(),
                    status,
                    content,
                    page_name: page.name.clone(),
                    page_title: page.title.clone(),
                    content_type: content_type.id.clone(),
                    is_journal: content_type.id == "journal",
                    journal_date: date.map(|d| d.to_string()),
                    due_date: block.properties.get("due_date").cloned(),
                    start_date: block.properties.get("start_date").cloned(),
                    priority: block.properties.get("priority").cloned(),
                });
            }
        }

        if !page_tasks.is_empty() {
            self.tasks.insert(key, page_tasks);
        }
    }

    /// Remove all todos from a specific page
    pub fn remove_page(&mut self, key: &PageKey) {
        self.tasks.remove(key);
    }

    /// Remove a regular page from the index
    pub fn remove_regular_page(&mut self, name: &str) {
        self.remove_page(&PageKey::page(name));
    }

    /// Remove a journal from the index
    pub fn remove_journal(&mut self, date: NaiveDate) {
        self.remove_page(&PageKey::journal(date));
    }

    /// Get all tasks across all pages
    pub fn get_all_tasks(&self) -> Vec<TaskItem> {
        self.tasks.values().flatten().cloned().collect()
    }

    /// Get the total number of tasks
    pub fn len(&self) -> usize {
        self.tasks.values().map(|v| v.len()).sum()
    }

    /// Check if index is empty
    pub fn is_empty(&self) -> bool {
        self.tasks.is_empty()
    }

    /// Clear the entire index
    pub fn clear(&mut self) {
        self.tasks.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tend_core::Block;
    use uuid::Uuid;

    fn make_page(name: &str, blocks: Vec<Block>) -> Page {
        let mut page = Page::new(name);
        for block in blocks {
            page.add_block(block);
        }
        page
    }

    #[test]
    fn test_tag_index_basic() {
        let mut index = TagIndex::new();

        let page = make_page(
            "Test Page",
            vec![
                Block::new("This is #project and #important"),
                Block::new("Also #project here"),
            ],
        );

        index.index_page(&page);

        let tags = index.get_all_tags();
        assert_eq!(tags.len(), 2);

        let project_tag = tags.iter().find(|t| t.name == "project").unwrap();
        assert_eq!(project_tag.count, 2);

        let important_tag = tags.iter().find(|t| t.name == "important").unwrap();
        assert_eq!(important_tag.count, 1);
    }

    #[test]
    fn test_tag_index_reindex_page() {
        let mut index = TagIndex::new();

        // Initial index
        let page1 = make_page("Test", vec![Block::new("#old-tag")]);
        index.index_page(&page1);
        assert_eq!(index.len(), 1);

        // Re-index with different tags
        let page2 = make_page("Test", vec![Block::new("#new-tag")]);
        index.index_page(&page2);

        let tags = index.get_all_tags();
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].name, "new-tag");
    }

    #[test]
    fn test_tag_index_remove_page() {
        let mut index = TagIndex::new();

        let page = make_page("Test", vec![Block::new("#tag")]);
        index.index_page(&page);
        assert_eq!(index.len(), 1);

        index.remove_page("Test");
        assert!(index.is_empty());
    }

    #[test]
    fn test_todo_index_basic() {
        let mut index = TodoIndex::new();

        let page = make_page(
            "Tasks",
            vec![
                Block::new("TODO Buy groceries"),
                Block::new("DOING Write code"),
                Block::new("DONE Review PR"),
                Block::new("Just a note"),
            ],
        );

        index.index_regular_page(&page);

        let tasks = index.get_all_tasks();
        assert_eq!(tasks.len(), 3);

        assert!(tasks.iter().any(|t| t.status == "TODO" && t.content == "Buy groceries"));
        assert!(tasks.iter().any(|t| t.status == "DOING" && t.content == "Write code"));
        assert!(tasks.iter().any(|t| t.status == "DONE" && t.content == "Review PR"));
    }

    #[test]
    fn test_todo_index_journal() {
        let mut index = TodoIndex::new();

        let date = NaiveDate::from_ymd_opt(2026, 1, 15).unwrap();
        let page = make_page("2026-01-15", vec![Block::new("TODO Daily task")]);

        index.index_journal(&page, date);

        let tasks = index.get_all_tasks();
        assert_eq!(tasks.len(), 1);
        assert!(tasks[0].is_journal);
        assert_eq!(tasks[0].journal_date, Some("2026-01-15".to_string()));
    }

    #[test]
    fn test_todo_index_reindex() {
        let mut index = TodoIndex::new();

        let page1 = make_page("Tasks", vec![Block::new("TODO Old task")]);
        index.index_regular_page(&page1);

        let page2 = make_page("Tasks", vec![Block::new("TODO New task")]);
        index.index_regular_page(&page2);

        let tasks = index.get_all_tasks();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].content, "New task");
    }
}
