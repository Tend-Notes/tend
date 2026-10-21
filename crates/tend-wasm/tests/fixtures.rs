// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Writes the fixture corpus that the browser-side test suite reads
// (packages/web/src/lib/wasm/bridge.test.ts).
//
// These are produced by the *server's* code, so the wasm build is checked
// against bytes Rust actually wrote rather than against itself. Running the
// Rust suite refreshes them; they are committed so the web suite can run on its
// own, and a diff in `git status` after `cargo test` is the signal that the
// format moved.
//
// Fixtures are deterministic apart from the keys, which cannot be: age mints
// random identities. The key material is therefore written alongside the
// ciphertext it belongs to.

use std::collections::HashMap;
use std::path::PathBuf;

use age::secrecy::ExposeSecret;
use tend_core::{Block, Page};
use uuid::Uuid;

fn fixtures_dir() -> PathBuf {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    std::fs::create_dir_all(&dir).expect("create fixtures dir");
    dir
}

/// Fixed uuids: the footer records them, so random ones would make every run
/// rewrite the fixture and turn the diff signal into noise.
const PARENT: &str = "11111111-1111-4111-8111-111111111111";
const CHILD: &str = "22222222-2222-4222-8222-222222222222";

fn fixture_page() -> Page {
    let parent: Uuid = PARENT.parse().unwrap();
    let child: Uuid = CHILD.parse().unwrap();

    let mut blocks = HashMap::new();
    blocks.insert(
        parent,
        Block {
            uuid: parent,
            content: "parent bullet".into(),
            parent_uuid: None,
            children: vec![child],
            collapsed: true,
            properties: HashMap::new(),
            depth: 0,
        },
    );
    blocks.insert(
        child,
        Block {
            uuid: child,
            content: "child — with em dash and ünïcode".into(),
            parent_uuid: Some(parent),
            children: vec![],
            collapsed: false,
            properties: HashMap::new(),
            depth: 1,
        },
    );

    let mut page = Page::new("Fixture Page");
    page.root_blocks = vec![parent];
    page.blocks = blocks;
    page.version = 7;
    // Fixed timestamps, for the same reason as the uuids.
    page.created_at = "2026-01-01T00:00:00Z".parse().unwrap();
    page.modified_at = "2026-01-01T00:00:00Z".parse().unwrap();
    page
}

#[test]
fn write_fixture_corpus() {
    let dir = fixtures_dir();
    let passphrase = "correct-horse-battery-staple";

    // --- format ---------------------------------------------------------
    let page = fixture_page();
    let page_json = serde_json::to_string_pretty(&page).unwrap();
    let markdown = tend_core::serializer::serialize_page(&page);

    std::fs::write(dir.join("page.json"), &page_json).unwrap();
    std::fs::write(dir.join("page.md"), &markdown).unwrap();

    // The fixture has to be something the server itself round-trips, or the
    // web suite would be asserting against a file that is already wrong.
    let reparsed = tend_core::parser::parse_markdown(&markdown, "Fixture Page").unwrap();
    assert_eq!(
        tend_core::serializer::serialize_page(&reparsed),
        markdown,
        "fixture must be stable under the server's own round trip"
    );

    // --- encryption -----------------------------------------------------
    let identity = tend_storage::encryption::generate_identity();
    let identity_str = identity.to_string().expose_secret().to_string();

    std::fs::write(dir.join("identity.txt"), &identity_str).unwrap();
    std::fs::write(
        dir.join("identity.age"),
        tend_storage::encryption::wrap_identity(&identity, passphrase).unwrap(),
    )
    .unwrap();
    std::fs::write(
        dir.join("note.md.age"),
        tend_storage::encryption::encrypt_to_recipient(
            "server-encrypted note body",
            &identity.to_public(),
        )
        .unwrap(),
    )
    .unwrap();
    std::fs::write(
        dir.join("encryption.verify"),
        tend_storage::encrypt("tend-encryption-verification", passphrase).unwrap(),
    )
    .unwrap();

    // Each fixture is readable by the code that will read it for real.
    assert_eq!(
        tend_storage::encryption::decrypt_with_identity(
            &std::fs::read(dir.join("note.md.age")).unwrap(),
            &identity
        )
        .unwrap(),
        "server-encrypted note body"
    );
    assert_eq!(
        tend_storage::decrypt(
            &std::fs::read(dir.join("encryption.verify")).unwrap(),
            passphrase
        )
        .unwrap(),
        "tend-encryption-verification"
    );
}
