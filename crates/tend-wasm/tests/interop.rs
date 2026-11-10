// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Interoperability between the browser bridge and the server.
//
// Hard requirement: a folder written by the browser must still be an ordinary
// Tend garden — `tend-server` can open it, and `age -d` decrypts it. These
// tests drive the bridge's functions and the server's filesystem layer against
// the *same* directory, in both directions, so a divergence fails here rather
// than silently producing a garden one side cannot read.
//
// The two sides share source (the bridge delegates to tend-core/tend-storage),
// which makes drift unlikely by construction; what these tests actually guard
// is that the bridge keeps delegating rather than growing its own logic.

use std::collections::HashMap;

use tempfile::TempDir;
use tend_core::{Block, Page};
use tend_storage::{EncryptedFileManager, FileManager};
use tend_wasm::*;
use uuid::Uuid;

/// A page with nesting, a collapsed bullet and a non-ASCII name — enough shape
/// that the footer, the indentation rules and filename encoding all matter.
fn sample_page(name: &str) -> Page {
    let parent = Uuid::new_v4();
    let child = Uuid::new_v4();

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

    let mut page = Page::new(name);
    page.root_blocks = vec![parent];
    page.blocks = blocks;
    page.version = 7;
    page
}

#[tokio::test]
async fn server_reads_a_page_the_bridge_serialized() {
    let dir = TempDir::new().unwrap();
    let fm = FileManager::new(dir.path()).unwrap();

    let page = sample_page("Bridge Written");
    let markdown = serialize_page_impl(&serde_json::to_string(&page).unwrap()).unwrap();

    // Write the bytes exactly as the browser would: encoded filename, .md.
    let path = dir
        .path()
        .join("pages")
        .join(format!("{}.md", encode_filename_impl("Bridge Written")));
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, &markdown).unwrap();

    // The server's own reader must make sense of it.
    let read = fm.read_page("Bridge Written").await.unwrap();
    assert_eq!(read.name, "Bridge Written");
    assert_eq!(read.version, 7, "page version survives the round trip");
    assert_eq!(read.root_blocks.len(), 1);
    assert_eq!(read.blocks.len(), 2, "parent and child both arrive");

    let child = read
        .blocks
        .values()
        .find(|b| b.parent_uuid.is_some())
        .expect("child block present");
    assert_eq!(child.content, "child — with em dash and ünïcode");
    assert!(
        read.blocks.values().any(|b| b.collapsed),
        "collapsed state survives"
    );
}

#[tokio::test]
async fn bridge_reads_a_page_the_server_wrote() {
    let dir = TempDir::new().unwrap();
    let fm = FileManager::new(dir.path()).unwrap();

    let page = sample_page("Server Written");
    fm.write_page(&page).await.unwrap();

    let path = dir
        .path()
        .join("pages")
        .join(format!("{}.md", encode_filename_impl("Server Written")));
    let on_disk = std::fs::read_to_string(&path).unwrap();

    let parsed_json = parse_markdown_impl(&on_disk, "Server Written").unwrap();
    let parsed: Page = serde_json::from_str(&parsed_json).unwrap();

    assert_eq!(parsed.blocks.len(), 2);
    assert_eq!(parsed.version, 7);

    // And re-serializing reproduces the file byte for byte, which is what stops
    // a browser edit from rewriting every file the server wrote.
    assert_eq!(
        serialize_page_impl(&parsed_json).unwrap(),
        on_disk,
        "bridge re-serialization is byte-identical to the server's file"
    );
}

#[test]
fn filename_encoding_matches_the_server() {
    // Names that actually need encoding, plus ones that must pass through.
    for name in [
        "Plain Name",
        "Weird: Name?",
        "100% sure",
        "a/b",
        "ünïcode — dash",
        "trailing space ",
    ] {
        assert_eq!(
            encode_filename_impl(name),
            tend_storage::encode_filename(name),
            "encoding diverged for {name:?}"
        );
        assert_eq!(
            decode_filename_impl(&encode_filename_impl(name)),
            name,
            "round trip failed for {name:?}"
        );
    }
}

#[test]
fn rejects_names_that_escape_the_garden() {
    assert!(validate_safe_name_impl("../../etc/passwd").is_err());
    assert!(validate_safe_name_impl("/absolute").is_err());
    assert!(validate_safe_name_impl("").is_err());
    assert!(validate_safe_name_impl("ordinary name").is_ok());
}

#[test]
fn server_decrypts_what_the_bridge_encrypted() {
    // The bridge mints an identity and encrypts to it, as it would when
    // creating an encrypted local garden.
    let identity = generate_identity_impl();
    let recipient = identity_to_recipient_impl(&identity).unwrap();
    let ciphertext = encrypt_to_recipient_impl("secret note body", &recipient).unwrap();

    assert!(
        tend_storage::is_age_encrypted(&ciphertext),
        "output is a real age file"
    );

    // The server's decrypt path recovers it.
    let server_identity = {
        use std::str::FromStr;
        tend_storage::encryption::Identity::from_str(identity.trim()).unwrap()
    };
    let plaintext =
        tend_storage::encryption::decrypt_with_identity(&ciphertext, &server_identity).unwrap();
    assert_eq!(plaintext, "secret note body");
}

#[test]
fn bridge_decrypts_what_the_server_encrypted() {
    let identity = tend_storage::encryption::generate_identity();
    let ciphertext =
        tend_storage::encryption::encrypt_to_recipient("from the server", &identity.to_public())
            .unwrap();

    use age::secrecy::ExposeSecret;
    let identity_str = identity.to_string().expose_secret().to_string();

    assert_eq!(
        decrypt_with_identity_impl(&ciphertext, &identity_str).unwrap(),
        "from the server"
    );
}

#[test]
fn wrapped_identity_crosses_both_ways() {
    let passphrase = "correct-horse-battery-staple";

    // Bridge wraps; server unwraps.
    let identity = generate_identity_impl();
    let wrapped = wrap_identity_impl(&identity, passphrase).unwrap();
    let unwrapped = tend_storage::encryption::unwrap_identity(&wrapped, passphrase).unwrap();
    use age::secrecy::ExposeSecret;
    assert_eq!(unwrapped.to_string().expose_secret().to_string(), identity);

    // Server wraps; bridge unwraps.
    let server_identity = tend_storage::encryption::generate_identity();
    let server_wrapped =
        tend_storage::encryption::wrap_identity(&server_identity, passphrase).unwrap();
    assert_eq!(
        unwrap_identity_impl(&server_wrapped, passphrase).unwrap(),
        server_identity.to_string().expose_secret().to_string()
    );

    // A wrong passphrase fails — this is also how unlock checks it.
    assert!(unwrap_identity_impl(&wrapped, "wrong passphrase").is_err());
}

#[test]
fn verify_file_matches_what_the_server_expects() {
    // `.tend/encryption.verify` is age-scrypt ciphertext of a fixed string; the
    // server checks it on unlock, so the bridge must write exactly that.
    let passphrase = "correct-horse-battery-staple";
    let verify = encrypt_scrypt_impl("tend-encryption-verification", passphrase).unwrap();

    assert_eq!(
        tend_storage::decrypt(&verify, passphrase).unwrap(),
        "tend-encryption-verification"
    );
    assert!(tend_storage::decrypt(&verify, "wrong").is_err());
}

#[tokio::test]
async fn server_opens_an_encrypted_garden_the_bridge_created() {
    // The full bootstrap a browser performs for a new encrypted local garden,
    // in the server's order: verify file first, then the wrapped identity.
    let dir = TempDir::new().unwrap();
    let passphrase = "correct-horse-battery-staple";
    let tend = dir.path().join(".tend");
    std::fs::create_dir_all(&tend).unwrap();
    std::fs::create_dir_all(dir.path().join("pages")).unwrap();

    std::fs::write(
        tend.join("encryption.verify"),
        encrypt_scrypt_impl("tend-encryption-verification", passphrase).unwrap(),
    )
    .unwrap();

    let identity = generate_identity_impl();
    std::fs::write(
        tend.join("identity.age"),
        wrap_identity_impl(&identity, passphrase).unwrap(),
    )
    .unwrap();

    // A note, encrypted to the garden recipient and named as the server names it.
    let page = sample_page("Secret Page");
    let markdown = serialize_page_impl(&serde_json::to_string(&page).unwrap()).unwrap();
    let recipient = identity_to_recipient_impl(&identity).unwrap();
    std::fs::write(
        dir.path()
            .join("pages")
            .join(format!("{}.md.age", encode_filename_impl("Secret Page"))),
        encrypt_to_recipient_impl(&markdown, &recipient).unwrap(),
    )
    .unwrap();

    // Now the server opens that folder as an encrypted garden and reads it.
    assert!(
        EncryptedFileManager::verify_passphrase(dir.path(), passphrase).unwrap(),
        "server accepts the bridge's verify file"
    );

    let efm = EncryptedFileManager::new(dir.path(), passphrase.to_string()).unwrap();
    let read = efm.read_page("Secret Page").await.unwrap();

    assert_eq!(read.blocks.len(), 2);
    assert_eq!(read.version, 7);
    assert!(
        read.blocks
            .values()
            .any(|b| b.content.contains("ünïcode")),
        "note content decrypts intact"
    );
}
