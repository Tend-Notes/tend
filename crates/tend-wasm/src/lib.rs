// SPDX-License-Identifier: MIT WITH Commons-Clause
//! WebAssembly bridge exposing Tend's on-disk format to the browser.
//!
//! A local-folder garden is written by the browser but must stay an ordinary
//! Tend garden: `tend-server` can open the same folder, and `age -d` still
//! decrypts its files. The only way to guarantee that is for both sides to run
//! the *same* code, so this crate is a thin wrapper — every function here
//! delegates to `tend-core` (and, later, `tend-storage`'s encryption) and adds
//! nothing but a JSON boundary.
//!
//! Deliberately no logic: a rule worth keeping, because any behaviour that
//! lives only here is behaviour the server does not have.
//!
//! The JSON on the boundary is `Page`'s own serde representation, which is
//! camelCase and already mirrored by `packages/web/src/types`.

use std::str::FromStr;

use tend_core::Page;
use tend_storage::encryption::{Identity, Recipient};
use wasm_bindgen::prelude::*;

// `expose_secret` is how age hands back a key's string form.
use age::secrecy::ExposeSecret;

// The exported `#[wasm_bindgen]` functions are wrappers that only translate the
// error type: `JsError` cannot be constructed off-wasm, so the work lives in
// plain `Result<_, String>` functions that `cargo test` can call directly.
// Keeping the split means the bridge is covered by the normal test run rather
// than needing a browser.

/// Serialize a page to the markdown + block-metadata-footer format.
///
/// Takes a JSON `Page`, returns the exact bytes the server would write.
pub fn serialize_page_impl(page_json: &str) -> Result<String, String> {
    let page: Page =
        serde_json::from_str(page_json).map_err(|e| format!("invalid Page JSON: {e}"))?;
    Ok(tend_core::serializer::serialize_page(&page))
}

/// Parse a markdown file (with or without a footer) into a `Page`.
///
/// `name` is the page name the file is stored under; the parser needs it
/// because it is not recorded in the file itself.
pub fn parse_markdown_impl(content: &str, name: &str) -> Result<String, String> {
    let page =
        tend_core::parser::parse_markdown(content, name).map_err(|e| format!("parse failed: {e}"))?;
    serde_json::to_string(&page).map_err(|e| format!("could not encode Page: {e}"))
}

// ---------------------------------------------------------------------------
// Filename encoding
// ---------------------------------------------------------------------------

/// Percent-encode a page name for use as a filename, exactly as the server does.
pub fn encode_filename_impl(name: &str) -> String {
    tend_storage::encode_filename(name)
}

/// Inverse of [`encode_filename_impl`].
pub fn decode_filename_impl(encoded: &str) -> String {
    tend_storage::decode_filename(encoded)
}

/// Reject names that would escape the garden directory.
pub fn validate_safe_name_impl(name: &str) -> Result<(), String> {
    tend_storage::validate_safe_name(name).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Encryption
//
// The garden's scheme, unchanged from the server: one random X25519 identity
// per garden, its secret wrapped once behind the passphrase with age-scrypt
// (`.tend/identity.age`), and note files encrypted to the X25519 recipient so
// no per-file KDF runs. Keys cross this boundary as their standard age strings
// ("AGE-SECRET-KEY-1…" / "age1…"), which is also how they sit on disk.
// ---------------------------------------------------------------------------

/// Mint a fresh per-garden identity. Returns its secret-key string.
pub fn generate_identity_impl() -> String {
    tend_storage::encryption::generate_identity()
        .to_string()
        .expose_secret()
        .to_string()
}

/// The public recipient ("age1…") for an identity secret key.
pub fn identity_to_recipient_impl(identity: &str) -> Result<String, String> {
    Ok(parse_identity(identity)?.to_public().to_string())
}

/// Wrap an identity secret behind the passphrase — scrypt runs once, here.
/// The result is what belongs at `.tend/identity.age`.
pub fn wrap_identity_impl(identity: &str, passphrase: &str) -> Result<Vec<u8>, String> {
    tend_storage::encryption::wrap_identity(&parse_identity(identity)?, passphrase)
        .map_err(|e| e.to_string())
}

/// Unwrap a stored identity. A wrong passphrase fails here, which is also how
/// unlock checks the passphrase.
pub fn unwrap_identity_impl(wrapped: &[u8], passphrase: &str) -> Result<String, String> {
    tend_storage::encryption::unwrap_identity(wrapped, passphrase)
        .map(|id| id.to_string().expose_secret().to_string())
        .map_err(|e| e.to_string())
}

/// Encrypt note content to the garden's recipient. No per-file KDF.
pub fn encrypt_to_recipient_impl(content: &str, recipient: &str) -> Result<Vec<u8>, String> {
    let recipient = Recipient::from_str(recipient).map_err(|e| format!("bad recipient: {e}"))?;
    tend_storage::encryption::encrypt_to_recipient(content, &recipient)
        .map_err(|e| e.to_string())
}

/// Decrypt note content with the garden's identity.
pub fn decrypt_with_identity_impl(encrypted: &[u8], identity: &str) -> Result<String, String> {
    tend_storage::encryption::decrypt_with_identity(encrypted, &parse_identity(identity)?)
        .map_err(|e| e.to_string())
}

/// Passphrase (age-scrypt) encryption, used for `.tend/encryption.verify`.
pub fn encrypt_scrypt_impl(content: &str, passphrase: &str) -> Result<Vec<u8>, String> {
    tend_storage::encrypt(content, passphrase).map_err(|e| e.to_string())
}

/// Inverse of [`encrypt_scrypt_impl`].
pub fn decrypt_scrypt_impl(encrypted: &[u8], passphrase: &str) -> Result<String, String> {
    tend_storage::decrypt(encrypted, passphrase).map_err(|e| e.to_string())
}

fn parse_identity(identity: &str) -> Result<Identity, String> {
    Identity::from_str(identity.trim()).map_err(|e| format!("bad identity key: {e}"))
}

// ---------------------------------------------------------------------------
// wasm_bindgen exports
// ---------------------------------------------------------------------------

#[wasm_bindgen]
pub fn encode_filename(name: &str) -> String {
    encode_filename_impl(name)
}

#[wasm_bindgen]
pub fn decode_filename(encoded: &str) -> String {
    decode_filename_impl(encoded)
}

#[wasm_bindgen]
pub fn validate_safe_name(name: &str) -> Result<(), JsError> {
    validate_safe_name_impl(name).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen]
pub fn generate_identity() -> String {
    generate_identity_impl()
}

#[wasm_bindgen]
pub fn identity_to_recipient(identity: &str) -> Result<String, JsError> {
    identity_to_recipient_impl(identity).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen]
pub fn wrap_identity(identity: &str, passphrase: &str) -> Result<Vec<u8>, JsError> {
    wrap_identity_impl(identity, passphrase).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen]
pub fn unwrap_identity(wrapped: &[u8], passphrase: &str) -> Result<String, JsError> {
    unwrap_identity_impl(wrapped, passphrase).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen]
pub fn encrypt_to_recipient(content: &str, recipient: &str) -> Result<Vec<u8>, JsError> {
    encrypt_to_recipient_impl(content, recipient).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen]
pub fn decrypt_with_identity(encrypted: &[u8], identity: &str) -> Result<String, JsError> {
    decrypt_with_identity_impl(encrypted, identity).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen]
pub fn encrypt_scrypt(content: &str, passphrase: &str) -> Result<Vec<u8>, JsError> {
    encrypt_scrypt_impl(content, passphrase).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen]
pub fn decrypt_scrypt(encrypted: &[u8], passphrase: &str) -> Result<String, JsError> {
    decrypt_scrypt_impl(encrypted, passphrase).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen]
pub fn serialize_page(page_json: &str) -> Result<String, JsError> {
    serialize_page_impl(page_json).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen]
pub fn parse_markdown(content: &str, name: &str) -> Result<String, JsError> {
    parse_markdown_impl(content, name).map_err(|e| JsError::new(&e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    /// A page with nested blocks, properties and a collapsed bullet — enough
    /// structure that a footer is written and the hierarchy has to survive it.
    fn sample_page_json() -> String {
        serde_json::json!({
            "name": "Notes",
            "title": "Notes",
            "rootBlocks": ["11111111-1111-4111-8111-111111111111"],
            "blocks": {
                "11111111-1111-4111-8111-111111111111": {
                    "uuid": "11111111-1111-4111-8111-111111111111",
                    "content": "parent bullet",
                    "parentUuid": null,
                    "children": ["22222222-2222-4222-8222-222222222222"],
                    "collapsed": true,
                    "properties": {},
                    "depth": 0
                },
                "22222222-2222-4222-8222-222222222222": {
                    "uuid": "22222222-2222-4222-8222-222222222222",
                    "content": "child bullet",
                    "parentUuid": "11111111-1111-4111-8111-111111111111",
                    "children": [],
                    "collapsed": false,
                    "properties": {},
                    "depth": 1
                }
            },
            "properties": {},
            "contentType": "page",
            "isJournal": false,
            "journalDate": null,
            "createdAt": "2026-10-21T00:00:00Z",
            "modifiedAt": "2026-10-21T00:00:00Z",
            "version": 3
        })
        .to_string()
    }

    #[test]
    fn serializes_exactly_what_tend_core_would() {
        let json = sample_page_json();
        let page: Page = serde_json::from_str(&json).unwrap();

        // The bridge must add nothing: byte-for-byte equal to calling the
        // library directly. This is the whole contract of this crate.
        assert_eq!(
            serialize_page_impl(&json).unwrap(),
            tend_core::serializer::serialize_page(&page)
        );
    }

    #[test]
    fn serialized_output_has_the_expected_shape() {
        let out = serialize_page_impl(&sample_page_json()).unwrap();

        assert!(out.starts_with("version:: 3\n"), "page version leads the file");
        assert!(out.contains("- parent bullet\n"), "bullets are plain markdown");
        assert!(out.contains("  - child bullet\n"), "children indent by two spaces");
        assert!(out.contains("  collapsed:: true\n"), "collapsed state is inline");
        assert!(out.contains("<!-- tend:blocks\n"), "block metadata footer is present");
        assert!(out.trim_end().ends_with("-->"), "footer closes the file");
    }

    #[test]
    fn round_trips_through_parse() {
        let markdown = serialize_page_impl(&sample_page_json()).unwrap();
        let reparsed_json = parse_markdown_impl(&markdown, "Notes").unwrap();

        // Serializing the reparsed page must reproduce the same file; that is
        // what makes a browser-written garden readable by the server.
        assert_eq!(serialize_page_impl(&reparsed_json).unwrap(), markdown);

        let page: Page = serde_json::from_str(&reparsed_json).unwrap();
        assert_eq!(page.name, "Notes");
        assert_eq!(page.root_blocks.len(), 1);
        assert_eq!(page.blocks.len(), 2, "parent and child both survive");
    }

    #[test]
    fn parses_a_file_with_no_footer() {
        // Markdown written by hand, or by another program, has no footer. The
        // parser rebuilds the hierarchy from indentation and mints uuids.
        let page_json = parse_markdown_impl("- alpha\n  - beta\n", "Hand").unwrap();
        let page: Page = serde_json::from_str(&page_json).unwrap();

        assert_eq!(page.root_blocks.len(), 1);
        assert_eq!(page.blocks.len(), 2);
    }

    #[test]
    fn rejects_json_that_is_not_a_page() {
        assert!(serialize_page_impl("{\"nope\": true}").is_err());
        assert!(serialize_page_impl("not json at all").is_err());
    }
}
