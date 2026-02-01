// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Markdown parser with embedded block metadata support
//!
//! Parses Markdown files in outliner format into our Block and Page models.
//! Block UUIDs and parent relationships are read from an embedded footer
//! comment, falling back to inline Logseq-style `id::` properties, or
//! generating new UUIDs if neither is present.
//!
//! Tend format (preferred):
//! ```markdown
//! - Block content here
//!   - Child block
//!
//! <!-- tend:blocks
//! uuid|parent|order
//! abc123||0
//! def456|abc123|0
//! -->
//! ```
//!
//! Logseq format (supported for import):
//! ```markdown
//! - Block content here
//!   id:: uuid-here
//!   - Child block
//!     id:: child-uuid
//! ```

use regex::Regex;
use std::collections::HashMap;
use std::sync::LazyLock;
use uuid::Uuid;

use crate::block::Block;
use crate::block_metadata::{parse_content_with_footer, BlockMetadata};
use crate::error::CoreError;
use crate::page::Page;

/// Regex to match a bullet line: captures indent and content
static BULLET_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(\s*)-\s(.*)$").unwrap());

/// Regex to match a property line: captures indent, key, and value
static PROPERTY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(\s*)([a-zA-Z][a-zA-Z0-9_-]*)::\s*(.*)$").unwrap());

/// Parse a Markdown file into a Page
///
/// Supports two UUID sources (in order of preference):
/// 1. Embedded footer (`<!-- tend:blocks ... -->`)
/// 2. Inline Logseq-style properties (`id:: uuid`)
/// 3. If neither present, generates new UUIDs
pub fn parse_markdown(content: &str, page_name: &str) -> Result<Page, CoreError> {
    // First, extract footer metadata if present
    let parsed = parse_content_with_footer(content);
    let markdown = &parsed.markdown;

    let mut page = Page::new(page_name);
    let lines: Vec<&str> = markdown.lines().collect();

    if lines.is_empty() {
        return Ok(page);
    }

    // Track blocks by their indent level to build the hierarchy
    // Stack of (indent_level, block_uuid)
    let mut block_stack: Vec<(usize, Uuid)> = Vec::new();
    let mut current_block: Option<Block> = None;

    // Track if we've seen a block yet (page properties come before blocks)
    let mut seen_first_block = false;

    for line in lines {
        // Try to match a bullet line
        if let Some(caps) = BULLET_RE.captures(line) {
            seen_first_block = true;

            // Save the previous block if any
            if let Some(block) = current_block.take() {
                save_block(&mut page, &mut block_stack, block);
            }

            let indent = caps.get(1).map_or(0, |m| m.as_str().len());
            let block_content = caps.get(2).map_or("", |m| m.as_str()).to_string();

            // Calculate depth (assuming 2 spaces per level)
            let depth = indent / 2;

            let mut block = Block::new(block_content);
            block.depth = depth;

            current_block = Some(block);
        }
        // Try to match a property line
        else if let Some(caps) = PROPERTY_RE.captures(line) {
            let key = caps.get(2).map_or("", |m| m.as_str());
            let value = caps.get(3).map_or("", |m| m.as_str());

            if let Some(ref mut block) = current_block {
                // Property belongs to the current block
                if key == "id" {
                    // Parse UUID from inline property (Logseq format)
                    // Only use if we don't have footer metadata
                    if parsed.metadata.is_none() {
                        if let Ok(uuid) = Uuid::parse_str(value) {
                            block.uuid = uuid;
                        }
                    }
                    // If we have footer metadata, ignore inline ids
                } else if key == "collapsed" {
                    block.collapsed = value == "true";
                } else {
                    block.set_property(key, value);
                }
            } else if !seen_first_block {
                // Property before any block - this is a page-level property
                if key == "version" {
                    if let Ok(v) = value.parse::<u64>() {
                        page.version = v;
                    }
                } else {
                    page.properties.insert(key.to_string(), value.to_string());
                }
            }
        }
        // Continuation line - content that continues from the previous block
        // This handles multiline content like code blocks where subsequent lines
        // don't start with "- " but are part of the same block
        else if let Some(ref mut block) = current_block {
            // Append the line as continuation content
            // Preserve the line exactly as-is (including leading whitespace)
            block.content.push('\n');
            block.content.push_str(line);
        }
        // Lines before any block that aren't properties are ignored
    }

    // Save the last block
    if let Some(block) = current_block.take() {
        save_block(&mut page, &mut block_stack, block);
    }

    // If we have footer metadata, apply UUIDs based on order
    if let Some(metadata) = parsed.metadata {
        apply_footer_metadata(&mut page, &metadata);
    }

    Ok(page)
}

/// Apply footer metadata to reassign UUIDs and rebuild parent relationships
fn apply_footer_metadata(page: &mut Page, metadata: &[BlockMetadata]) {
    // The blocks are already in order in root_blocks and children
    // We need to map from the order they were parsed to the UUIDs in metadata

    // First, collect all blocks in depth-first order (same order as footer)
    let ordered_uuids: Vec<Uuid> = page.root_blocks.iter()
        .flat_map(|root| collect_uuids_depth_first(page, root))
        .collect();

    // If counts don't match, metadata is out of sync - keep generated UUIDs
    if ordered_uuids.len() != metadata.len() {
        return;
    }

    // Build mapping from old UUID to new UUID from metadata
    let mut uuid_mapping: HashMap<Uuid, Uuid> = HashMap::new();
    for (old_uuid, meta) in ordered_uuids.iter().zip(metadata.iter()) {
        uuid_mapping.insert(*old_uuid, meta.uuid);
    }

    // Rebuild blocks with new UUIDs
    let mut new_blocks: HashMap<Uuid, Block> = HashMap::new();

    for (old_uuid, new_uuid) in &uuid_mapping {
        if let Some(mut block) = page.blocks.remove(old_uuid) {
            block.uuid = *new_uuid;

            // Update parent_uuid
            if let Some(old_parent) = block.parent_uuid {
                block.parent_uuid = uuid_mapping.get(&old_parent).copied();
            }

            // Update children UUIDs
            block.children = block.children.iter()
                .filter_map(|old_child| uuid_mapping.get(old_child).copied())
                .collect();

            new_blocks.insert(*new_uuid, block);
        }
    }

    page.blocks = new_blocks;

    // Update root_blocks
    page.root_blocks = page.root_blocks.iter()
        .filter_map(|old| uuid_mapping.get(old).copied())
        .collect();
}

/// Collect UUIDs in depth-first order
fn collect_uuids_depth_first(page: &Page, uuid: &Uuid) -> Vec<Uuid> {
    let mut result = vec![*uuid];
    if let Some(block) = page.blocks.get(uuid) {
        for child in &block.children {
            result.extend(collect_uuids_depth_first(page, child));
        }
    }
    result
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
    fn test_parse_block_with_inline_id() {
        // Logseq-style inline id:: when no footer present
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

    #[test]
    fn test_parse_page_properties() {
        let content = r#"version:: 5
custom:: value

- First block
  id:: 12345678-1234-1234-1234-123456789abc"#;

        let page = parse_markdown(content, "Test").unwrap();

        // Check page-level properties
        assert_eq!(page.version, 5);
        assert_eq!(
            page.properties.get("custom"),
            Some(&"value".to_string())
        );

        // Check that block was parsed correctly
        assert_eq!(page.blocks.len(), 1);
    }

    #[test]
    fn test_parse_with_footer_metadata() {
        let content = r#"- First block
- Second block

<!-- tend:blocks
DO NOT EDIT - Tend uses this to track block relationships.
If corrupted, Tend will rebuild from markdown structure.

uuid|parent|order
aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa||0
bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb||1
-->"#;

        let page = parse_markdown(content, "Test").unwrap();

        assert_eq!(page.root_blocks.len(), 2);
        assert_eq!(page.blocks.len(), 2);

        // UUIDs should come from footer
        let first_uuid = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap();
        let second_uuid = Uuid::parse_str("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb").unwrap();

        assert!(page.blocks.contains_key(&first_uuid));
        assert!(page.blocks.contains_key(&second_uuid));

        assert_eq!(page.root_blocks[0], first_uuid);
        assert_eq!(page.root_blocks[1], second_uuid);
    }

    #[test]
    fn test_parse_nested_with_footer() {
        let content = r#"- Parent
  - Child

<!-- tend:blocks
DO NOT EDIT - Tend uses this to track block relationships.
If corrupted, Tend will rebuild from markdown structure.

uuid|parent|order
aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa||0
bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb|aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa|0
-->"#;

        let page = parse_markdown(content, "Test").unwrap();

        let parent_uuid = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap();
        let child_uuid = Uuid::parse_str("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb").unwrap();

        assert_eq!(page.root_blocks.len(), 1);
        assert_eq!(page.root_blocks[0], parent_uuid);

        let parent = page.get_block(&parent_uuid).unwrap();
        assert_eq!(parent.children.len(), 1);
        assert_eq!(parent.children[0], child_uuid);

        let child = page.get_block(&child_uuid).unwrap();
        assert_eq!(child.parent_uuid, Some(parent_uuid));
    }

    #[test]
    fn test_footer_takes_precedence_over_inline_id() {
        // Footer UUIDs should override inline id:: properties
        let content = r#"- Block with inline ID
  id:: 99999999-9999-9999-9999-999999999999

<!-- tend:blocks
DO NOT EDIT - Tend uses this to track block relationships.
If corrupted, Tend will rebuild from markdown structure.

uuid|parent|order
aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa||0
-->"#;

        let page = parse_markdown(content, "Test").unwrap();

        // UUID from footer should be used, not inline
        let footer_uuid = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap();
        assert!(page.blocks.contains_key(&footer_uuid));

        // Inline UUID should NOT be present
        let inline_uuid = Uuid::parse_str("99999999-9999-9999-9999-999999999999").unwrap();
        assert!(!page.blocks.contains_key(&inline_uuid));
    }

    #[test]
    fn test_mismatched_footer_falls_back_to_generated() {
        // If footer has wrong number of blocks, ignore it
        let content = r#"- Block A
- Block B
- Block C

<!-- tend:blocks
DO NOT EDIT - Tend uses this to track block relationships.
If corrupted, Tend will rebuild from markdown structure.

uuid|parent|order
aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa||0
-->"#;

        let page = parse_markdown(content, "Test").unwrap();

        // Should have 3 blocks with generated UUIDs (footer mismatch)
        assert_eq!(page.blocks.len(), 3);

        // Footer UUID should NOT be used since count doesn't match
        let footer_uuid = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap();
        assert!(!page.blocks.contains_key(&footer_uuid));
    }

    #[test]
    fn test_parse_multiline_content() {
        // Code blocks and other multiline content should be preserved
        let content = r#"- ```js
console.log("hello")
```"#;

        let page = parse_markdown(content, "Test").unwrap();

        assert_eq!(page.blocks.len(), 1);
        let block = page.blocks.values().next().unwrap();

        // Content should include all lines
        assert_eq!(block.content, "```js\nconsole.log(\"hello\")\n```");
    }

    #[test]
    fn test_parse_multiline_code_block_with_blank_lines() {
        // Code blocks with blank lines inside should preserve them
        let content = r#"- ```rust
fn main() {

    println!("hello");
}
```"#;

        let page = parse_markdown(content, "Test").unwrap();

        assert_eq!(page.blocks.len(), 1);
        let block = page.blocks.values().next().unwrap();

        // Content should include all lines including blank line
        assert_eq!(
            block.content,
            "```rust\nfn main() {\n\n    println!(\"hello\");\n}\n```"
        );
    }

    #[test]
    fn test_multiline_roundtrip() {
        use crate::serializer::serialize_page;

        // Create a page with multiline content
        let mut page = Page::new("Test");
        let mut block = Block::new("```js\nconsole.log(\"hello\")\n```".to_string());
        block.uuid = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap();
        page.add_block(block);

        // Serialize and parse back
        let serialized = serialize_page(&page);
        let page2 = parse_markdown(&serialized, "Test").unwrap();

        // Content should be preserved through roundtrip
        assert_eq!(page2.blocks.len(), 1);
        let block2 = page2.blocks.values().next().unwrap();
        assert_eq!(block2.content, "```js\nconsole.log(\"hello\")\n```");
    }
}
