// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Markdown serializer
//!
//! Serializes our Page/Block models back to Logseq-compatible Markdown format.

use crate::block::Block;
use crate::page::Page;
use uuid::Uuid;

/// Serialize a Page to Logseq-compatible Markdown
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

    for root_uuid in &page.root_blocks {
        serialize_block_recursive(&mut output, page, root_uuid, 0);
    }

    output
}

/// Serialize a single block and its children recursively
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

    // Write the block ID
    output.push_str(&indent);
    output.push_str("  id:: ");
    output.push_str(&block.uuid.to_string());
    output.push('\n');

    // Write collapsed state if true
    if block.collapsed {
        output.push_str(&indent);
        output.push_str("  collapsed:: true\n");
    }

    // Write other properties (excluding id and collapsed which we handle specially)
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
pub fn serialize_blocks(blocks: &[Block]) -> String {
    let mut output = String::new();

    for block in blocks {
        serialize_single_block(&mut output, block, block.depth);
    }

    output
}

/// Serialize a single block (without children)
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
        assert!(output.contains("id::"));
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

        let original = r#"version:: 42

- Parent block
  id:: 12345678-1234-1234-1234-123456789abc
  status:: active
  - Child block
    id:: 87654321-4321-4321-4321-cba987654321
"#;

        let page = parse_markdown(original, "Test").unwrap();
        assert_eq!(page.version, 42);

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
    }
}
