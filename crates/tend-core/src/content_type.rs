// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Content type definitions
//!
//! A ContentType defines a category of sheets (e.g., pages, journals, meetings).
//! Each content type has its own directory and optional date-based organization.

use serde::{Deserialize, Serialize};

/// A content type defines how a category of sheets is stored and organized.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContentType {
    /// Unique identifier (e.g., "page", "journal", "meetings")
    pub id: String,

    /// Display name (e.g., "Page", "Journal", "Meetings")
    pub name: String,

    /// Directory relative to garden root (e.g., "pages", "journals", "meetings")
    pub directory: String,

    /// Whether to organize sheets into date subfolders (e.g., meetings/2026-01-21/Standup.md)
    #[serde(default)]
    pub save_by_date: bool,

    /// Markdown template for new sheets of this type
    #[serde(default)]
    pub template: String,
}

impl ContentType {
    /// Create a new content type
    pub fn new(id: impl Into<String>, name: impl Into<String>, directory: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            directory: directory.into(),
            save_by_date: false,
            template: String::new(),
        }
    }

    /// Built-in "page" content type
    pub fn page() -> Self {
        Self::new("page", "Page", "pages")
    }

    /// Built-in "journal" content type
    pub fn journal() -> Self {
        Self::new("journal", "Journal", "journals")
    }

    /// Default content types for a new garden
    pub fn defaults() -> Vec<Self> {
        vec![Self::page(), Self::journal()]
    }

    /// Check if this is a built-in content type
    pub fn is_builtin(&self) -> bool {
        self.id == "page" || self.id == "journal"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_content_types() {
        let defaults = ContentType::defaults();
        assert_eq!(defaults.len(), 2);
        assert_eq!(defaults[0].id, "page");
        assert_eq!(defaults[1].id, "journal");
    }

    #[test]
    fn test_is_builtin() {
        assert!(ContentType::page().is_builtin());
        assert!(ContentType::journal().is_builtin());
        assert!(!ContentType::new("meetings", "Meetings", "meetings").is_builtin());
    }

    #[test]
    fn test_save_by_date_default() {
        let ct = ContentType::new("test", "Test", "test");
        assert!(!ct.save_by_date);
    }
}
