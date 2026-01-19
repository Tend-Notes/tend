// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Logseq-compatible Markdown parser
//!
//! Parses Markdown files in Logseq's outliner format into our Block and Page models.
//!
//! Logseq format:
//! ```markdown
//! - Block content here
//!   id:: uuid-here
//!   property:: value
//!   - Child block
//!     id:: child-uuid
//! ```

use regex::Regex;
use std::sync::LazyLock;
use uuid::Uuid;

use crate::block::Block;
use crate::error::CoreError;
use crate::page::Page;

/// Regex to match a bullet line: captures indent and content
static BULLET_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(\s*)-\s(.*)$").unwrap());

/// Regex to match a property line: captures indent, key, and value
static PROPERTY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(\s*)([a-zA-Z][a-zA-Z0-9_-]*)::\s*(.*)$").unwrap());

/// Parse a Logseq-format Markdown file into a Page
pub fn parse_markdown(content: &str, page_name: &str) -> Result<Page, CoreError> {
    let mut page = Page::new(page_name);
    let lines: Vec<&str> = content.lines().collect();

    if lines.is_empty() {
        return Ok(page);
    }

    // Track blocks by their indent level to build the hierarchy
    // Stack of (indent_level, block_uuid)
    let mut block_stack: Vec<(usize, Uuid)> = Vec::new();
    let mut current_block: Option<Block> = None;

    for line in lines {
        // Try to match a bullet line
        if let Some(caps) = BULLET_RE.captures(line) {
            // Save the previous block if any
            if let Some(block) = current_block.take() {
                save_block(&mut page, &mut block_stack, block);
            }

            let indent = caps.get(1).map_or(0, |m| m.as_str().len());
            let content = caps.get(2).map_or("", |m| m.as_str()).to_string();

            // Calculate depth (assuming 2 spaces per level)
            let depth = indent / 2;

            let mut block = Block::new(content);
            block.depth = depth;

            current_block = Some(block);
        }
        // Try to match a property line
        else if let Some(caps) = PROPERTY_RE.captures(line) {
            let key = caps.get(2).map_or("", |m| m.as_str());
            let value = caps.get(3).map_or("", |m| m.as_str());

            if let Some(ref mut block) = current_block {
                if key == "id" {
                    // Parse UUID and set it on the block
                    if let Ok(uuid) = Uuid::parse_str(value) {
                        block.uuid = uuid;
                    }
                } else if key == "collapsed" {
                    block.collapsed = value == "true";
                } else {
                    block.set_property(key, value);
                }
            }
        }
        // Empty line or other content - could be continuation of block content
        // For now, we'll ignore non-bullet, non-property lines
    }

    // Save the last block
    if let Some(block) = current_block.take() {
        save_block(&mut page, &mut block_stack, block);
    }

    Ok(page)
}

/// Save a block and update the hierarchy
fn save_block(page: &mut Page, block_stack: &mut Vec<(usize, Uuid)>, mut block: Block) {
    let depth = block.depth;
    let uuid = block.uuid;

    // Pop blocks from stack that are at same or greater depth
    while let Some((stack_depth, _)) = block_stack.last() {
        if *stack_depth >= depth {
            block_stack.pop();
        } else {
            break;
        }
    }

    // Set parent if there's a block on the stack
    if let Some((_, parent_uuid)) = block_stack.last() {
        block.parent_uuid = Some(*parent_uuid);
        // Add this block as child of parent
        if let Some(parent) = page.blocks.get_mut(parent_uuid) {
            parent.children.push(uuid);
        }
    }

    // Push this block onto the stack
    block_stack.push((depth, uuid));

    // Add block to page
    page.add_block(block);
}

/// Parse a journal filename to extract the date
/// Supports: 2025-01-18.md, 2025_01_18.md
pub fn parse_journal_filename(filename: &str) -> Option<chrono::NaiveDate> {
    let name = filename.trim_end_matches(".md");

    // Try ISO format (2025-01-18)
    if let Ok(date) = chrono::NaiveDate::parse_from_str(name, "%Y-%m-%d") {
        return Some(date);
    }

    // Try underscore format (2025_01_18)
    if let Ok(date) = chrono::NaiveDate::parse_from_str(name, "%Y_%m_%d") {
        return Some(date);
    }

    None
}

/// Check if a filename looks like a journal entry
pub fn is_journal_filename(filename: &str) -> bool {
    parse_journal_filename(filename).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_page() {
        let content = r#"- First block
- Second block
- Third block"#;

        let page = parse_markdown(content, "Test").unwrap();

        assert_eq!(page.root_blocks.len(), 3);
        assert_eq!(page.blocks.len(), 3);
    }

    #[test]
    fn test_parse_nested_blocks() {
        let content = r#"- Parent block
  - Child block
    - Grandchild block
  - Another child
- Another parent"#;

        let page = parse_markdown(content, "Test").unwrap();

        assert_eq!(page.root_blocks.len(), 2);
        assert_eq!(page.blocks.len(), 5);

        // Check hierarchy
        let parent_uuid = page.root_blocks[0];
        let parent = page.get_block(&parent_uuid).unwrap();
        assert_eq!(parent.children.len(), 2);
    }

    #[test]
    fn test_parse_block_with_id() {
        let content = r#"- Block with ID
  id:: 12345678-1234-1234-1234-123456789abc"#;

        let page = parse_markdown(content, "Test").unwrap();

        let block = page.blocks.values().next().unwrap();
        assert_eq!(
            block.uuid,
            Uuid::parse_str("12345678-1234-1234-1234-123456789abc").unwrap()
        );
    }

    #[test]
    fn test_parse_block_with_properties() {
        let content = r#"- Task block
  id:: 12345678-1234-1234-1234-123456789abc
  status:: TODO
  priority:: high"#;

        let page = parse_markdown(content, "Test").unwrap();

        let block = page.blocks.values().next().unwrap();
        assert_eq!(block.get_property("status"), Some(&"TODO".to_string()));
        assert_eq!(block.get_property("priority"), Some(&"high".to_string()));
    }

    #[test]
    fn test_parse_collapsed_block() {
        let content = r#"- Collapsed block
  collapsed:: true
  - Hidden child"#;

        let page = parse_markdown(content, "Test").unwrap();

        let parent_uuid = page.root_blocks[0];
        let parent = page.get_block(&parent_uuid).unwrap();
        assert!(parent.collapsed);
    }

    #[test]
    fn test_parse_journal_filename() {
        assert_eq!(
            parse_journal_filename("2025-01-18.md"),
            Some(chrono::NaiveDate::from_ymd_opt(2025, 1, 18).unwrap())
        );
        assert_eq!(
            parse_journal_filename("2025_01_18.md"),
            Some(chrono::NaiveDate::from_ymd_opt(2025, 1, 18).unwrap())
        );
        assert_eq!(parse_journal_filename("not-a-date.md"), None);
    }

    #[test]
    fn test_is_journal_filename() {
        assert!(is_journal_filename("2025-01-18.md"));
        assert!(is_journal_filename("2025_01_18.md"));
        assert!(!is_journal_filename("My Page.md"));
    }
}
