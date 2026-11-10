// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Template instantiation
//!
//! Creating a sheet from a template copies the template's block tree onto the
//! new page with fresh UUIDs, and reports where the caret should land. A
//! template marks that spot with `{{cursor}}`, which is removed on the way
//! through.
//!
//! # Concepts
//!
//! - **template** — an ordinary [`Page`], parsed from `.tend/templates/<type>.md`
//!   or from a content type's `template` string.
//! - **target** — the new page being built. Blocks are added to it; nothing is
//!   read back out.
//! - **cursor position** — the new UUID of the block that held the marker, plus
//!   the offset the marker sat at. Only the first marker is reported; the rest
//!   are stripped silently.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{Block, Page};

/// The spot a template asks the caret to land on.
pub const CURSOR_MARKER: &str = "{{cursor}}";

/// Where the caret goes after a template is instantiated.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorPosition {
    /// UUID of the block that held the marker, in the *new* page.
    pub block_uuid: String,
    /// Offset the marker sat at within that block's content.
    ///
    /// A **byte** offset, from `str::find`. For ASCII content — every template
    /// shipped and every one written so far — that is also the character
    /// offset the editor reads it as. See `REWRITE-BACKLOG.md`.
    pub offset: usize,
}

/// Remove every `{{cursor}}` from `content`, reporting the first one's offset
/// when `track` is set.
///
/// `track` is false once a cursor has already been found elsewhere in the
/// template: the marker still has to go, it just no longer wins the caret.
pub fn strip_cursor_marker(content: &str, track: bool) -> (String, Option<usize>) {
    let offset = if track { content.find(CURSOR_MARKER) } else { None };
    match offset {
        Some(offset) => (content.replace(CURSOR_MARKER, ""), Some(offset)),
        // Nothing to report, but a marker may still be present (track = false),
        // and an untracked marker must not survive into the page.
        None if content.contains(CURSOR_MARKER) => (content.replace(CURSOR_MARKER, ""), None),
        None => (content.to_string(), None),
    }
}

/// Copy every block of `template` onto `target` with fresh UUIDs, preserving
/// the tree, `collapsed` and each block's properties.
///
/// Returns the caret position if the template asked for one. `target` keeps
/// whatever blocks it already had; the template's roots are appended after
/// them.
pub fn instantiate(template: &Page, target: &mut Page) -> Option<CursorPosition> {
    let mut cursor = None;
    for root in &template.root_blocks {
        copy_tree(template, *root, None, target, &mut cursor);
    }
    cursor
}

/// Copy one block and its descendants, returning the copy's new UUID.
///
/// `None` means the UUID named no block — a dangling child reference in a
/// hand-edited template — and that subtree is skipped rather than aborting the
/// whole instantiation.
fn copy_tree(
    template: &Page,
    uuid: Uuid,
    new_parent: Option<Uuid>,
    target: &mut Page,
    cursor: &mut Option<CursorPosition>,
) -> Option<Uuid> {
    let source = template.blocks.get(&uuid)?;
    let new_uuid = Uuid::new_v4();

    let (content, offset) = strip_cursor_marker(&source.content, cursor.is_none());
    if let Some(offset) = offset {
        *cursor = Some(CursorPosition {
            block_uuid: new_uuid.to_string(),
            offset,
        });
    }

    let mut block = Block::with_uuid(new_uuid, content);
    block.collapsed = source.collapsed;
    block.properties = source.properties.clone();
    block.parent_uuid = new_parent;
    block.children = source
        .children
        .iter()
        .filter_map(|child| copy_tree(template, *child, Some(new_uuid), target, cursor))
        .collect();

    target.add_block(block);
    Some(new_uuid)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// Build a template page: `specs` is (content, child indices), index 0 being
    /// the single root.
    fn template(specs: &[(&str, &[usize])]) -> Page {
        let uuids: Vec<Uuid> = specs.iter().map(|_| Uuid::new_v4()).collect();
        let mut page = Page::new("Template");
        for (i, (content, children)) in specs.iter().enumerate() {
            let mut block = Block::with_uuid(uuids[i], *content);
            block.children = children.iter().map(|c| uuids[*c]).collect();
            block.parent_uuid = specs
                .iter()
                .position(|(_, kids)| kids.contains(&i))
                .map(|parent| uuids[parent]);
            page.add_block(block);
        }
        page
    }

    #[test]
    fn strip_cursor_marker_table() {
        // (content, track) -> (stripped, offset)
        let cases = [
            (("TODO {{cursor}}", true), ("TODO ", Some(5))),
            (("TODO {{cursor}}", false), ("TODO ", None)),
            (("no marker", true), ("no marker", None)),
            (("no marker", false), ("no marker", None)),
            (("{{cursor}}", true), ("", Some(0))),
            // Every marker goes; only the first is reported.
            (("a{{cursor}}b{{cursor}}c", true), ("abc", Some(1))),
            (("a{{cursor}}b{{cursor}}c", false), ("abc", None)),
        ];
        for ((content, track), (want_content, want_offset)) in cases {
            let got = strip_cursor_marker(content, track);
            assert_eq!(
                got,
                (want_content.to_string(), want_offset),
                "strip_cursor_marker({content:?}, {track})"
            );
        }
    }

    #[test]
    fn offset_is_a_byte_offset() {
        // Documents the quirk CursorPosition::offset names: "é" is two bytes, so
        // the editor is handed 2 for a caret that belongs after character 1.
        let (content, offset) = strip_cursor_marker("é{{cursor}}", true);
        assert_eq!(content, "é");
        assert_eq!(offset, Some(2), "byte offset");
        assert_eq!(content.chars().count(), 1, "but only one character precedes it");
    }

    #[test]
    fn instantiate_copies_the_tree_with_new_uuids() {
        let src = template(&[("root", &[1, 2]), ("first child", &[]), ("second child", &[])]);
        let mut page = Page::new("New");
        assert_eq!(instantiate(&src, &mut page), None, "no marker, no cursor");

        assert_eq!(page.blocks.len(), 3);
        assert_eq!(page.root_blocks.len(), 1);
        let root = &page.blocks[&page.root_blocks[0]];
        assert_eq!(root.content, "root");
        assert_eq!(root.parent_uuid, None);
        assert_eq!(root.children.len(), 2);

        let kids: Vec<&str> = root
            .children
            .iter()
            .map(|c| page.blocks[c].content.as_str())
            .collect();
        assert_eq!(kids, vec!["first child", "second child"], "order preserved");
        for child in &root.children {
            assert_eq!(page.blocks[child].parent_uuid, Some(root.uuid));
        }

        for uuid in page.blocks.keys() {
            assert!(!src.blocks.contains_key(uuid), "every UUID is fresh");
        }
    }

    #[test]
    fn instantiate_preserves_collapsed_and_properties() {
        let mut src = template(&[("root", &[1]), ("child", &[])]);
        let child_uuid = src.blocks[&src.root_blocks[0]].children[0];
        let child = src.blocks.get_mut(&child_uuid).unwrap();
        child.collapsed = true;
        child.properties = HashMap::from([("status".to_string(), "TODO".to_string())]);

        let mut page = Page::new("New");
        instantiate(&src, &mut page);

        let root = &page.blocks[&page.root_blocks[0]];
        let copied = &page.blocks[&root.children[0]];
        assert!(copied.collapsed);
        assert_eq!(copied.properties.get("status"), Some(&"TODO".to_string()));
    }

    #[test]
    fn instantiate_reports_the_first_marker_and_strips_the_rest() {
        let src = template(&[
            ("heading", &[1, 2]),
            ("write {{cursor}}here", &[]),
            ("and {{cursor}}not here", &[]),
        ]);
        let mut page = Page::new("New");
        let cursor = instantiate(&src, &mut page).expect("a cursor was marked");

        let at = &page.blocks[&cursor.block_uuid.parse::<Uuid>().unwrap()];
        assert_eq!(at.content, "write here");
        assert_eq!(cursor.offset, 6);

        let contents: Vec<&str> = page.blocks.values().map(|b| b.content.as_str()).collect();
        assert!(
            !contents.iter().any(|c| c.contains(CURSOR_MARKER)),
            "no marker survives into the page: {contents:?}"
        );
        assert!(contents.contains(&"and not here"));
    }

    #[test]
    fn instantiate_skips_a_dangling_child_reference() {
        // A hand-edited template can name a child that is not in the file. The
        // subtree is dropped; the rest of the page still instantiates.
        let mut src = template(&[("root", &[1]), ("real child", &[])]);
        let root_uuid = src.root_blocks[0];
        src.blocks.get_mut(&root_uuid).unwrap().children.push(Uuid::new_v4());

        let mut page = Page::new("New");
        instantiate(&src, &mut page);

        assert_eq!(page.blocks.len(), 2);
        let root = &page.blocks[&page.root_blocks[0]];
        assert_eq!(root.children.len(), 1, "the missing child is not linked");
        assert_eq!(page.blocks[&root.children[0]].content, "real child");
    }

    #[test]
    fn instantiate_of_an_empty_template_adds_nothing() {
        let mut page = Page::new("New");
        assert_eq!(instantiate(&Page::new("Template"), &mut page), None);
        assert!(page.blocks.is_empty());
    }
}
