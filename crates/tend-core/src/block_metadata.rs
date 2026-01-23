// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Block metadata footer parsing and serialization
//!
//! Tend stores block UUIDs and parent relationships in an HTML comment footer
//! at the end of each markdown file. This keeps the main markdown body clean
//! and human-readable while maintaining stable block identifiers.
//!
//! Format:
//! ```text
//! <!-- tend:blocks
//! DO NOT EDIT - Tend uses this to track block relationships.
//! If corrupted, Tend will rebuild from markdown structure.
//!
//! uuid|parent|order
//! abc123||0
//! def456|abc123|0
//! ghi789||1
//! -->
//! ```

use regex::Regex;
use std::collections::HashMap;
use std::sync::LazyLock;
use uuid::Uuid;

/// Marker that identifies the start of a Tend block metadata footer
pub const FOOTER_START: &str = "<!-- tend:blocks";
/// Warning text included in the footer
pub const FOOTER_WARNING: &str =
    "DO NOT EDIT - Tend uses this to track block relationships.\nIf corrupted, Tend will rebuild from markdown structure.";
/// Header for the data table
pub const FOOTER_HEADER: &str = "uuid|parent|order";

/// Metadata for a single block as stored in the footer
#[derive(Debug, Clone, PartialEq)]
pub struct BlockMetadata {
    pub uuid: Uuid,
    pub parent_uuid: Option<Uuid>,
    pub order: usize,
}

/// Result of parsing a markdown file that may contain a footer
#[derive(Debug)]
pub struct ParsedContent {
    /// The markdown content without the footer
    pub markdown: String,
    /// Block metadata if footer was present and valid
    pub metadata: Option<Vec<BlockMetadata>>,
}

/// Regex to match the footer block at end of content
/// Captures any preceding blank lines as part of the footer
static FOOTER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?s)\n*<!-- tend:blocks\n.*?-->\s*$").unwrap()
});

/// Parse content that may contain a block metadata footer
///
/// Returns the markdown content (without footer) and any parsed metadata.
/// If the footer is missing or malformed, metadata will be None.
pub fn parse_content_with_footer(content: &str) -> ParsedContent {
    // Try to find and extract the footer
    if let Some(mat) = FOOTER_RE.find(content) {
        let footer_text = mat.as_str();
        let markdown = content[..mat.start()].to_string();

        // Parse the footer data
        match parse_footer(footer_text) {
            Some(metadata) => ParsedContent {
                markdown,
                metadata: Some(metadata),
            },
            None => {
                // Footer was malformed, treat as if no footer
                ParsedContent {
                    markdown: content.to_string(),
                    metadata: None,
                }
            }
        }
    } else {
        // No footer found
        ParsedContent {
            markdown: content.to_string(),
            metadata: None,
        }
    }
}

/// Parse the footer section to extract block metadata
fn parse_footer(footer: &str) -> Option<Vec<BlockMetadata>> {
    let mut metadata = Vec::new();
    let mut in_data_section = false;

    for line in footer.lines() {
        let line = line.trim();

        // Skip empty lines and comments
        if line.is_empty() || line.starts_with("<!--") || line.starts_with("-->") {
            continue;
        }

        // Skip warning text
        if line.starts_with("DO NOT EDIT") || line.starts_with("If corrupted") {
            continue;
        }

        // Check for header line
        if line == FOOTER_HEADER {
            in_data_section = true;
            continue;
        }

        // Parse data lines
        if in_data_section {
            if let Some(block_meta) = parse_metadata_line(line) {
                metadata.push(block_meta);
            } else {
                // Malformed line - footer is corrupt
                return None;
            }
        }
    }

    if metadata.is_empty() {
        None
    } else {
        Some(metadata)
    }
}

/// Parse a single metadata line: "uuid|parent|order"
fn parse_metadata_line(line: &str) -> Option<BlockMetadata> {
    let parts: Vec<&str> = line.split('|').collect();
    if parts.len() != 3 {
        return None;
    }

    let uuid = Uuid::parse_str(parts[0]).ok()?;

    let parent_uuid = if parts[1].is_empty() {
        None
    } else {
        Some(Uuid::parse_str(parts[1]).ok()?)
    };

    let order = parts[2].parse().ok()?;

    Some(BlockMetadata {
        uuid,
        parent_uuid,
        order,
    })
}

/// Serialize block metadata to a footer string
pub fn serialize_footer(metadata: &[BlockMetadata]) -> String {
    let mut output = String::new();

    output.push_str("\n");
    output.push_str(FOOTER_START);
    output.push_str("\n");
    output.push_str(FOOTER_WARNING);
    output.push_str("\n\n");
    output.push_str(FOOTER_HEADER);
    output.push_str("\n");

    for meta in metadata {
        output.push_str(&meta.uuid.to_string());
        output.push('|');
        if let Some(parent) = meta.parent_uuid {
            output.push_str(&parent.to_string());
        }
        output.push('|');
        output.push_str(&meta.order.to_string());
        output.push('\n');
    }

    output.push_str("-->");

    output
}

/// Build metadata list from a page's blocks in depth-first order
pub fn blocks_to_metadata(
    root_blocks: &[Uuid],
    blocks: &HashMap<Uuid, crate::Block>,
) -> Vec<BlockMetadata> {
    let mut metadata = Vec::new();
    let mut sibling_counts: HashMap<Option<Uuid>, usize> = HashMap::new();

    for root_uuid in root_blocks {
        collect_metadata_recursive(
            root_uuid,
            None,
            blocks,
            &mut metadata,
            &mut sibling_counts,
        );
    }

    metadata
}

fn collect_metadata_recursive(
    uuid: &Uuid,
    parent_uuid: Option<Uuid>,
    blocks: &HashMap<Uuid, crate::Block>,
    metadata: &mut Vec<BlockMetadata>,
    sibling_counts: &mut HashMap<Option<Uuid>, usize>,
) {
    let order = sibling_counts.entry(parent_uuid).or_insert(0);
    let current_order = *order;
    *order += 1;

    metadata.push(BlockMetadata {
        uuid: *uuid,
        parent_uuid,
        order: current_order,
    });

    if let Some(block) = blocks.get(uuid) {
        for child_uuid in &block.children {
            collect_metadata_recursive(
                child_uuid,
                Some(*uuid),
                blocks,
                metadata,
                sibling_counts,
            );
        }
    }
}

/// Rebuild block hierarchy from metadata
///
/// Returns (root_blocks, parent_map) where parent_map maps child UUID to parent UUID
pub fn metadata_to_hierarchy(
    metadata: &[BlockMetadata],
) -> (Vec<Uuid>, HashMap<Uuid, Option<Uuid>>) {
    let mut root_blocks = Vec::new();
    let mut parent_map = HashMap::new();

    // Group by parent to reconstruct order
    let mut children_by_parent: HashMap<Option<Uuid>, Vec<(usize, Uuid)>> = HashMap::new();

    for meta in metadata {
        parent_map.insert(meta.uuid, meta.parent_uuid);
        children_by_parent
            .entry(meta.parent_uuid)
            .or_default()
            .push((meta.order, meta.uuid));
    }

    // Sort children by order and extract root blocks
    if let Some(roots) = children_by_parent.get(&None) {
        let mut sorted_roots = roots.clone();
        sorted_roots.sort_by_key(|(order, _)| *order);
        root_blocks = sorted_roots.into_iter().map(|(_, uuid)| uuid).collect();
    }

    (root_blocks, parent_map)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_empty_content() {
        let result = parse_content_with_footer("- Just some markdown");
        assert_eq!(result.markdown, "- Just some markdown");
        assert!(result.metadata.is_none());
    }

    #[test]
    fn test_parse_content_with_footer() {
        let content = r#"- First block
- Second block

<!-- tend:blocks
DO NOT EDIT - Tend uses this to track block relationships.
If corrupted, Tend will rebuild from markdown structure.

uuid|parent|order
12345678-1234-1234-1234-123456789abc||0
87654321-4321-4321-4321-cba987654321|12345678-1234-1234-1234-123456789abc|0
-->"#;

        let result = parse_content_with_footer(content);

        assert_eq!(result.markdown, "- First block\n- Second block");
        assert!(result.metadata.is_some());

        let metadata = result.metadata.unwrap();
        assert_eq!(metadata.len(), 2);

        assert_eq!(
            metadata[0].uuid,
            Uuid::parse_str("12345678-1234-1234-1234-123456789abc").unwrap()
        );
        assert!(metadata[0].parent_uuid.is_none());
        assert_eq!(metadata[0].order, 0);

        assert_eq!(
            metadata[1].uuid,
            Uuid::parse_str("87654321-4321-4321-4321-cba987654321").unwrap()
        );
        assert_eq!(
            metadata[1].parent_uuid,
            Some(Uuid::parse_str("12345678-1234-1234-1234-123456789abc").unwrap())
        );
        assert_eq!(metadata[1].order, 0);
    }

    #[test]
    fn test_serialize_footer() {
        let metadata = vec![
            BlockMetadata {
                uuid: Uuid::parse_str("12345678-1234-1234-1234-123456789abc").unwrap(),
                parent_uuid: None,
                order: 0,
            },
            BlockMetadata {
                uuid: Uuid::parse_str("87654321-4321-4321-4321-cba987654321").unwrap(),
                parent_uuid: Some(Uuid::parse_str("12345678-1234-1234-1234-123456789abc").unwrap()),
                order: 0,
            },
        ];

        let footer = serialize_footer(&metadata);

        assert!(footer.contains("<!-- tend:blocks"));
        assert!(footer.contains("DO NOT EDIT"));
        assert!(footer.contains("uuid|parent|order"));
        assert!(footer.contains("12345678-1234-1234-1234-123456789abc||0"));
        assert!(footer.contains("87654321-4321-4321-4321-cba987654321|12345678-1234-1234-1234-123456789abc|0"));
        assert!(footer.ends_with("-->"));
    }

    #[test]
    fn test_roundtrip() {
        let original_metadata = vec![
            BlockMetadata {
                uuid: Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap(),
                parent_uuid: None,
                order: 0,
            },
            BlockMetadata {
                uuid: Uuid::parse_str("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb").unwrap(),
                parent_uuid: Some(Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap()),
                order: 0,
            },
            BlockMetadata {
                uuid: Uuid::parse_str("cccccccc-cccc-cccc-cccc-cccccccccccc").unwrap(),
                parent_uuid: None,
                order: 1,
            },
        ];

        let footer = serialize_footer(&original_metadata);
        let content = format!("- Block A\n  - Block B\n- Block C{}", footer);

        let parsed = parse_content_with_footer(&content);
        assert!(parsed.metadata.is_some());

        let parsed_metadata = parsed.metadata.unwrap();
        assert_eq!(parsed_metadata.len(), original_metadata.len());

        for (orig, parsed) in original_metadata.iter().zip(parsed_metadata.iter()) {
            assert_eq!(orig.uuid, parsed.uuid);
            assert_eq!(orig.parent_uuid, parsed.parent_uuid);
            assert_eq!(orig.order, parsed.order);
        }
    }

    #[test]
    fn test_malformed_footer_returns_none() {
        let content = r#"- Some content

<!-- tend:blocks
DO NOT EDIT - Tend uses this to track block relationships.
If corrupted, Tend will rebuild from markdown structure.

uuid|parent|order
not-a-valid-uuid||0
-->"#;

        let result = parse_content_with_footer(content);
        // Malformed footer should be treated as no footer
        assert!(result.metadata.is_none());
    }

    #[test]
    fn test_metadata_to_hierarchy() {
        let uuid_a = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap();
        let uuid_b = Uuid::parse_str("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb").unwrap();
        let uuid_c = Uuid::parse_str("cccccccc-cccc-cccc-cccc-cccccccccccc").unwrap();

        let metadata = vec![
            BlockMetadata {
                uuid: uuid_a,
                parent_uuid: None,
                order: 0,
            },
            BlockMetadata {
                uuid: uuid_b,
                parent_uuid: Some(uuid_a),
                order: 0,
            },
            BlockMetadata {
                uuid: uuid_c,
                parent_uuid: None,
                order: 1,
            },
        ];

        let (root_blocks, parent_map) = metadata_to_hierarchy(&metadata);

        assert_eq!(root_blocks.len(), 2);
        assert_eq!(root_blocks[0], uuid_a);
        assert_eq!(root_blocks[1], uuid_c);

        assert_eq!(parent_map.get(&uuid_a), Some(&None));
        assert_eq!(parent_map.get(&uuid_b), Some(&Some(uuid_a)));
        assert_eq!(parent_map.get(&uuid_c), Some(&None));
    }
}
