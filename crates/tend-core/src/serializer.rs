// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Markdown serializer with embedded block metadata
//!
//! Serializes Page/Block models to clean Markdown with block metadata
//! stored in a footer comment. The main body remains human-readable
//! without inline UUID properties.

use crate::block::Block;
use crate::block_metadata::{blocks_to_metadata, serialize_footer};
use crate::page::Page;
use uuid::Uuid;

/// Serialize a Page to Markdown with embedded block metadata footer
pub fn serialize_page(page: &Page) -> String {
    let mut output = String::new();

    // Write page-level properties first (before any blocks)
    // Version is stored as a page property for conflict detection
    output.push_str(&format!("version:: {}\n", page.version));

    // Write other page properties
    for (key, value) in &page.properties {
        output.push_str(&format!("{}:: {}\n", key, value));
    }

    // Add a blank line between page properties and blocks (if there are properties and blocks)
    if !page.root_blocks.is_empty() {
        output.push('\n');
    }

    // Serialize block content (clean markdown, no inline ids)
    for root_uuid in &page.root_blocks {
        serialize_block_recursive(&mut output, page, root_uuid, 0);
    }

    // Add block metadata footer
    if !page.root_blocks.is_empty() {
        let metadata = blocks_to_metadata(&page.root_blocks, &page.blocks);
        output.push_str(&serialize_footer(&metadata));
    }

    output
}

/// Serialize a single block and its children recursively
/// Now writes clean markdown without inline id:: properties
fn serialize_block_recursive(output: &mut String, page: &Page, uuid: &Uuid, depth: usize) {
    let Some(block) = page.get_block(uuid) else {
        return;
    };

    let indent = "  ".repeat(depth);

    // Write the bullet and content
    output.push_str(&indent);
    output.push_str("- ");
    output.push_str(&block.content);
    output.push('\n');

    // Write collapsed state if true (this is a UI property, keep inline)
    if block.collapsed {
        output.push_str(&indent);
        output.push_str("  collapsed:: true\n");
    }

    // Write other user-facing properties (excluding id which goes in footer)
    for (key, value) in &block.properties {
        if key != "id" && key != "collapsed" {
            output.push_str(&indent);
            output.push_str("  ");
            output.push_str(key);
            output.push_str(":: ");
            output.push_str(value);
            output.push('\n');
        }
    }

    // Recursively serialize children
    for child_uuid in &block.children {
        serialize_block_recursive(output, page, child_uuid, depth + 1);
    }
}

/// Serialize a list of blocks (without page context) - useful for API responses
/// This version still includes inline ids for compatibility
pub fn serialize_blocks(blocks: &[Block]) -> String {
    let mut output = String::new();

    for block in blocks {
        serialize_single_block(&mut output, block, block.depth);
    }

    output
}

/// Serialize a single block (without children) - includes inline id for API use
fn serialize_single_block(output: &mut String, block: &Block, depth: usize) {
    let indent = "  ".repeat(depth);

    output.push_str(&indent);
    output.push_str("- ");
    output.push_str(&block.content);
    output.push('\n');

    output.push_str(&indent);
    output.push_str("  id:: ");
    output.push_str(&block.uuid.to_string());
    output.push('\n');

    if block.collapsed {
        output.push_str(&indent);
        output.push_str("  collapsed:: true\n");
    }

    for (key, value) in &block.properties {
        if key != "id" && key != "collapsed" {
            output.push_str(&indent);
            output.push_str("  ");
            output.push_str(key);
            output.push_str(":: ");
            output.push_str(value);
            output.push('\n');
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_serialize_simple_page() {
        let mut page = Page::new("Test");

        let block1 = Block::new("First block");
        let block2 = Block::new("Second block");

        page.add_block(block1);
        page.add_block(block2);

        let output = serialize_page(&page);

        assert!(output.contains("- First block"));
        assert!(output.contains("- Second block"));
        // Should have footer with block metadata
        assert!(output.contains("<!-- tend:blocks"));
        assert!(output.contains("uuid|parent|order"));
    }

    #[test]
    fn test_serialize_no_inline_ids() {
        let mut page = Page::new("Test");

        let block = Block::new("Test block");
        page.add_block(block);

        let output = serialize_page(&page);

        // Main content should NOT have inline id::
        let lines: Vec<&str> = output.lines().collect();
        let content_lines: Vec<_> = lines.iter()
            .take_while(|l| !l.starts_with("<!-- tend:blocks"))
            .collect();

        for line in content_lines {
            assert!(!line.contains("id::"), "Found inline id:: in content: {}", line);
        }
    }

    #[test]
    fn test_serialize_nested_blocks() {
        let mut page = Page::new("Test");

        let mut parent = Block::new("Parent");
        let child = Block::new("Child");

        let parent_uuid = parent.uuid;
        let child_uuid = child.uuid;

        parent.children.push(child_uuid);

        let mut child_block = child;
        child_block.parent_uuid = Some(parent_uuid);
        child_block.depth = 1;

        page.add_block(parent);
        page.add_block(child_block);

        let output = serialize_page(&page);

        // Parent should have no indentation
        assert!(output.contains("- Parent"));
        // Child should be indented
        assert!(output.contains("  - Child"));
        // Footer should have parent relationship
        assert!(output.contains(&format!("{}|{}|0", child_uuid, parent_uuid)));
    }

    #[test]
    fn test_serialize_block_with_properties() {
        let mut page = Page::new("Test");

        let mut block = Block::new("Task");
        block.set_property("status", "TODO");
        block.set_property("priority", "high");
        block.collapsed = true;

        page.add_block(block);

        let output = serialize_page(&page);

        assert!(output.contains("- Task"));
        assert!(output.contains("status:: TODO"));
        assert!(output.contains("priority:: high"));
        assert!(output.contains("collapsed:: true"));
    }

    #[test]
    fn test_roundtrip() {
        use crate::parser::parse_markdown;

        let mut page = Page::new("Test");
        page.version = 42;

        let mut parent = Block::with_uuid(
            Uuid::parse_str("12345678-1234-1234-1234-123456789abc").unwrap(),
            "Parent block",
        );
        parent.set_property("status", "active");

        let mut child = Block::with_uuid(
            Uuid::parse_str("87654321-4321-4321-4321-cba987654321").unwrap(),
            "Child block",
        );
        child.parent_uuid = Some(parent.uuid);
        child.depth = 1;

        parent.children.push(child.uuid);

        page.add_block(parent);
        page.add_block(child);

        let serialized = serialize_page(&page);

        // Parse again
        let page2 = parse_markdown(&serialized, "Test").unwrap();

        // Check that version is preserved
        assert_eq!(page2.version, 42);

        // Check that structure is preserved
        assert_eq!(page.root_blocks.len(), page2.root_blocks.len());
        assert_eq!(page.blocks.len(), page2.blocks.len());

        // Check that UUIDs are preserved
        let block1 = page
            .get_block(&Uuid::parse_str("12345678-1234-1234-1234-123456789abc").unwrap())
            .unwrap();
        let block2 = page2
            .get_block(&Uuid::parse_str("12345678-1234-1234-1234-123456789abc").unwrap())
            .unwrap();

        assert_eq!(block1.content, block2.content);
        assert_eq!(block1.get_property("status"), block2.get_property("status"));

        // Check child relationship preserved
        let child1 = page
            .get_block(&Uuid::parse_str("87654321-4321-4321-4321-cba987654321").unwrap())
            .unwrap();
        let child2 = page2
            .get_block(&Uuid::parse_str("87654321-4321-4321-4321-cba987654321").unwrap())
            .unwrap();

        assert_eq!(child1.parent_uuid, child2.parent_uuid);
    }

    #[test]
    fn test_empty_page_no_footer() {
        let page = Page::new("Empty");
        let output = serialize_page(&page);

        assert!(!output.contains("<!-- tend:blocks"));
    }
}
