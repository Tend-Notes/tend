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
// Derived data: tasks and tags
// ---------------------------------------------------------------------------
//
// A local garden builds its own task list, tag list, backlinks and graph in
// memory, with no server to ask. Only the reading-meaning-out-of-a-block half
// comes from here; the aggregation (which tag appears how often, which pages
// link where) is bookkeeping the caller does for itself, and nothing in it can
// disagree with the server about the file format.
//
// Per page and stateless, deliberately. An index living in wasm would hold the
// garden's decrypted content in linear memory, which the browser's garbage
// collector does not reclaim — locking the garden would then mean freeing a
// wasm object correctly rather than dropping a reference.

/// Every task in a page: the blocks that open with a status keyword.
///
/// `content_type_json` is the sheet's content type (its `id` decides whether
/// the task is a journal entry) and `date` its filed-under date as
/// `YYYY-MM-DD`, or null for a type that is not dated.
pub fn extract_tasks_impl(
    page_json: &str,
    content_type_json: &str,
    date: Option<&str>,
) -> Result<String, String> {
    let page: Page =
        serde_json::from_str(page_json).map_err(|e| format!("invalid Page JSON: {e}"))?;
    let content_type: tend_core::ContentType = serde_json::from_str(content_type_json)
        .map_err(|e| format!("invalid ContentType JSON: {e}"))?;
    let date = match date {
        Some(d) => Some(
            chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d")
                .map_err(|e| format!("invalid date {d:?}: {e}"))?,
        ),
        None => None,
    };

    let tasks = tend_index::tasks_in_page(&page, &content_type, date);
    serde_json::to_string(&tasks).map_err(|e| format!("could not encode tasks: {e}"))
}

/// Every tag occurrence in a page, lowercased, with the block it was found in.
pub fn extract_tags_impl(page_json: &str) -> Result<String, String> {
    let page: Page =
        serde_json::from_str(page_json).map_err(|e| format!("invalid Page JSON: {e}"))?;
    let tags = tend_index::tags_in_page(&page);
    serde_json::to_string(&tags).map_err(|e| format!("could not encode tags: {e}"))
}

// ---------------------------------------------------------------------------
// Saving a page, and creating one from a template
// ---------------------------------------------------------------------------

/// Apply a save: replace a page's blocks with the ones the editor is holding.
///
/// `blocks_json` is an array of `BlockData` — the same payload the browser
/// already POSTs to the server. `expected_version`, when given, fails the call
/// if the page on disk has moved on, and the error message carries the current
/// version so the caller can raise the same conflict it raises for a server
/// garden.
pub fn apply_block_updates_impl(
    page_json: &str,
    blocks_json: &str,
    expected_version: Option<u64>,
) -> Result<String, String> {
    let mut page: Page =
        serde_json::from_str(page_json).map_err(|e| format!("invalid Page JSON: {e}"))?;
    let blocks: Vec<tend_core::BlockData> =
        serde_json::from_str(blocks_json).map_err(|e| format!("invalid BlockData JSON: {e}"))?;
    page.apply_block_updates(blocks, expected_version)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&page).map_err(|e| format!("could not encode Page: {e}"))
}

/// Merge page-level property changes: a `null` value removes the key, and a key
/// the caller does not mention is left alone.
pub fn apply_property_updates_impl(
    page_json: &str,
    properties_json: &str,
) -> Result<String, String> {
    let mut page: Page =
        serde_json::from_str(page_json).map_err(|e| format!("invalid Page JSON: {e}"))?;
    let properties: std::collections::HashMap<String, Option<String>> =
        serde_json::from_str(properties_json).map_err(|e| format!("invalid properties JSON: {e}"))?;
    page.apply_property_updates(properties);
    serde_json::to_string(&page).map_err(|e| format!("could not encode Page: {e}"))
}

/// Copy a template's blocks onto a new page with fresh UUIDs.
///
/// Returns `{ "page": Page, "cursorPosition": CursorPosition | null }` — the
/// same two things `POST /sheets/{type}` answers with.
pub fn instantiate_template_impl(template_json: &str, target_json: &str) -> Result<String, String> {
    let template: Page =
        serde_json::from_str(template_json).map_err(|e| format!("invalid template JSON: {e}"))?;
    let mut page: Page =
        serde_json::from_str(target_json).map_err(|e| format!("invalid Page JSON: {e}"))?;
    let cursor = tend_core::instantiate(&template, &mut page);
    serde_json::to_string(&serde_json::json!({ "page": page, "cursorPosition": cursor }))
        .map_err(|e| format!("could not encode result: {e}"))
}

/// Remove `{{cursor}}` from a single string, reporting the first marker's
/// offset when `track` is set.
///
/// Returns `{ "content": string, "offset": number | null }`. Used for content
/// the caller supplies directly, where there is no template page to walk.
pub fn strip_cursor_marker_impl(content: &str, track: bool) -> Result<String, String> {
    let (content, offset) = tend_core::strip_cursor_marker(content, track);
    serde_json::to_string(&serde_json::json!({ "content": content, "offset": offset }))
        .map_err(|e| format!("could not encode result: {e}"))
}

// ---------------------------------------------------------------------------
// Where a sheet's file lives
// ---------------------------------------------------------------------------
//
// Path segments, not a path: the File System Access API walks one directory
// handle at a time, so the caller needs the pieces rather than a joined string.

/// The path segments of a sheet's file, below the garden root.
///
/// `date` is the filed-under date as `YYYY-MM-DD`, or null; a date-foldered
/// type needs one, and the caller resolves "today" for itself (the server does
/// the same, so this stays free of the clock). `encrypted` picks the `.md.age`
/// extension, `encode` the percent-encoded leaf filename — false gives the
/// legacy un-encoded form, which still has to be *read*.
pub fn sheet_rel_path_impl(
    content_type_json: &str,
    name: &str,
    date: Option<&str>,
    encrypted: bool,
    encode: bool,
) -> Result<String, String> {
    let content_type = parse_content_type(content_type_json)?;
    let segments = tend_storage::sheet_rel(
        &content_type,
        name,
        parse_date(date)?,
        sheet_ext(encrypted),
        encode,
    );
    serde_json::to_string(&segments).map_err(|e| format!("could not encode segments: {e}"))
}

/// What a file a listing walk found is a sheet of, if anything.
///
/// The inverse of [`sheet_rel_path_impl`]: `rel_dirs_json` is the array of
/// directory names between the content-type directory and the file, `filename`
/// includes the extension. Returns `{ "name": string, "date": string | null }`,
/// or `null` for a file that is not a sheet of this type.
pub fn sheet_ref_impl(
    content_type_json: &str,
    rel_dirs_json: &str,
    filename: &str,
    encrypted: bool,
) -> Result<String, String> {
    let content_type = parse_content_type(content_type_json)?;
    let rel_dirs: Vec<String> =
        serde_json::from_str(rel_dirs_json).map_err(|e| format!("invalid rel_dirs JSON: {e}"))?;
    let found = tend_storage::sheet_ref(&content_type, &rel_dirs, filename, sheet_ext(encrypted));
    let value = match found {
        Some((name, date)) => serde_json::json!({
            "name": name,
            "date": date.map(|d| d.format("%Y-%m-%d").to_string()),
        }),
        None => serde_json::Value::Null,
    };
    serde_json::to_string(&value).map_err(|e| format!("could not encode result: {e}"))
}

/// A sheet's `PageMeta` from its name and date alone, for a listing that has
/// not read the files.
pub fn sheet_ref_meta_impl(
    content_type_json: &str,
    bare_name: &str,
    date: Option<&str>,
) -> Result<String, String> {
    let content_type = parse_content_type(content_type_json)?;
    let meta = tend_storage::sheet_ref_meta(&content_type, bare_name, parse_date(date)?);
    serde_json::to_string(&meta).map_err(|e| format!("could not encode PageMeta: {e}"))
}

/// A sheet's full `PageMeta`, without parsing its body.
///
/// `created_at_ms` and `modified_at_ms` are milliseconds since the epoch, which
/// is what the File System Access API's `File.lastModified` gives.
pub fn sheet_meta_impl(
    content_type_json: &str,
    bare_name: &str,
    date: Option<&str>,
    block_count: usize,
    created_at_ms: i64,
    modified_at_ms: i64,
) -> Result<String, String> {
    let content_type = parse_content_type(content_type_json)?;
    let meta = tend_storage::sheet_meta(
        &content_type,
        bare_name,
        parse_date(date)?,
        block_count,
        parse_millis(created_at_ms)?,
        parse_millis(modified_at_ms)?,
    );
    serde_json::to_string(&meta).map_err(|e| format!("could not encode PageMeta: {e}"))
}

/// Order a listing the way the sidebar expects: date-named types newest date
/// first, everything else most recently modified first.
pub fn sort_sheets_impl(sheets_json: &str, content_type_json: &str) -> Result<String, String> {
    let content_type = parse_content_type(content_type_json)?;
    let mut sheets: Vec<tend_core::PageMeta> =
        serde_json::from_str(sheets_json).map_err(|e| format!("invalid PageMeta JSON: {e}"))?;
    tend_storage::sort_sheets(&mut sheets, &content_type);
    serde_json::to_string(&sheets).map_err(|e| format!("could not encode PageMeta: {e}"))
}

fn parse_content_type(json: &str) -> Result<tend_core::ContentType, String> {
    serde_json::from_str(json).map_err(|e| format!("invalid ContentType JSON: {e}"))
}

fn parse_date(date: Option<&str>) -> Result<Option<chrono::NaiveDate>, String> {
    match date {
        Some(d) => chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d")
            .map(Some)
            .map_err(|e| format!("invalid date {d:?}: {e}")),
        None => Ok(None),
    }
}

fn parse_millis(ms: i64) -> Result<chrono::DateTime<chrono::Utc>, String> {
    chrono::DateTime::from_timestamp_millis(ms)
        .ok_or_else(|| format!("timestamp out of range: {ms}"))
}

fn sheet_ext(encrypted: bool) -> &'static str {
    if encrypted {
        tend_storage::ENCRYPTED_EXT
    } else {
        tend_storage::MD_EXT
    }
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
pub fn extract_tasks(
    page_json: &str,
    content_type_json: &str,
    date: Option<String>,
) -> Result<String, JsError> {
    extract_tasks_impl(page_json, content_type_json, date.as_deref()).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen]
pub fn extract_tags(page_json: &str) -> Result<String, JsError> {
    extract_tags_impl(page_json).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen]
pub fn apply_block_updates(
    page_json: &str,
    blocks_json: &str,
    expected_version: Option<u64>,
) -> Result<String, JsError> {
    apply_block_updates_impl(page_json, blocks_json, expected_version).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen]
pub fn apply_property_updates(page_json: &str, properties_json: &str) -> Result<String, JsError> {
    apply_property_updates_impl(page_json, properties_json).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen]
pub fn instantiate_template(template_json: &str, target_json: &str) -> Result<String, JsError> {
    instantiate_template_impl(template_json, target_json).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen]
pub fn strip_cursor_marker(content: &str, track: bool) -> Result<String, JsError> {
    strip_cursor_marker_impl(content, track).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen]
pub fn sheet_rel_path(
    content_type_json: &str,
    name: &str,
    date: Option<String>,
    encrypted: bool,
    encode: bool,
) -> Result<String, JsError> {
    sheet_rel_path_impl(content_type_json, name, date.as_deref(), encrypted, encode)
        .map_err(|e| JsError::new(&e))
}

#[wasm_bindgen]
pub fn sheet_ref(
    content_type_json: &str,
    rel_dirs_json: &str,
    filename: &str,
    encrypted: bool,
) -> Result<String, JsError> {
    sheet_ref_impl(content_type_json, rel_dirs_json, filename, encrypted)
        .map_err(|e| JsError::new(&e))
}

#[wasm_bindgen]
pub fn sheet_ref_meta(
    content_type_json: &str,
    bare_name: &str,
    date: Option<String>,
) -> Result<String, JsError> {
    sheet_ref_meta_impl(content_type_json, bare_name, date.as_deref()).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen]
pub fn sheet_meta(
    content_type_json: &str,
    bare_name: &str,
    date: Option<String>,
    block_count: usize,
    created_at_ms: i64,
    modified_at_ms: i64,
) -> Result<String, JsError> {
    sheet_meta_impl(
        content_type_json,
        bare_name,
        date.as_deref(),
        block_count,
        created_at_ms,
        modified_at_ms,
    )
    .map_err(|e| JsError::new(&e))
}

#[wasm_bindgen]
pub fn sort_sheets(sheets_json: &str, content_type_json: &str) -> Result<String, JsError> {
    sort_sheets_impl(sheets_json, content_type_json).map_err(|e| JsError::new(&e))
}

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

#[cfg(test)]
mod derived_data_tests {
    use super::*;

    /// A page holding a task, a tagged block and an ordinary one.
    fn page_json() -> String {
        serde_json::json!({
            "name": "2026-10-29",
            "title": "2026-10-29",
            "rootBlocks": ["11111111-1111-4111-8111-111111111111"],
            "blocks": {
                "11111111-1111-4111-8111-111111111111": {
                    "uuid": "11111111-1111-4111-8111-111111111111",
                    "content": "TODO file the return",
                    "parentUuid": null,
                    "children": [],
                    "collapsed": false,
                    "properties": { "due_date": "2026-11-01", "priority": "1" },
                    "depth": 0
                },
                "22222222-2222-4222-8222-222222222222": {
                    "uuid": "22222222-2222-4222-8222-222222222222",
                    "content": "about #Tax and #filing",
                    "parentUuid": null,
                    "children": [],
                    "collapsed": false,
                    "properties": {},
                    "depth": 0
                },
                "33333333-3333-4333-8333-333333333333": {
                    "uuid": "33333333-3333-4333-8333-333333333333",
                    "content": "no task, no tag",
                    "parentUuid": null,
                    "children": [],
                    "collapsed": false,
                    "properties": {},
                    "depth": 0
                }
            },
            "properties": {},
            "contentType": "journal",
            "isJournal": true,
            "journalDate": "2026-10-29",
            "version": 1,
            "createdAt": "2026-10-29T00:00:00Z",
            "modifiedAt": "2026-10-29T00:00:00Z"
        })
        .to_string()
    }

    fn journal_type_json() -> String {
        serde_json::to_string(&tend_core::ContentType::journal()).unwrap()
    }

    #[test]
    fn tasks_come_back_with_their_properties_and_date() {
        let json =
            extract_tasks_impl(&page_json(), &journal_type_json(), Some("2026-10-29")).unwrap();
        let tasks: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(tasks.as_array().unwrap().len(), 1);
        let task = &tasks[0];
        assert_eq!(task["status"], "TODO");
        assert_eq!(task["content"], "file the return");
        assert_eq!(task["dueDate"], "2026-11-01");
        assert_eq!(task["priority"], "1");
        assert_eq!(task["isJournal"], true);
        assert_eq!(task["journalDate"], "2026-10-29");
    }

    #[test]
    fn tags_come_back_lowercased_with_their_block() {
        let json = extract_tags_impl(&page_json()).unwrap();
        let tags: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();

        let mut names: Vec<&str> = tags.iter().map(|t| t["tag"].as_str().unwrap()).collect();
        names.sort();
        assert_eq!(names, vec!["filing", "tax"]);

        for tag in &tags {
            assert_eq!(tag["pageName"], "2026-10-29");
            assert_eq!(tag["blockUuid"], "22222222-2222-4222-8222-222222222222");
        }
    }

    #[test]
    fn an_undated_type_needs_no_date() {
        let page_type = serde_json::to_string(&tend_core::ContentType::page()).unwrap();
        let json = extract_tasks_impl(&page_json(), &page_type, None).unwrap();
        let tasks: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(tasks[0]["isJournal"], false);
        assert_eq!(tasks[0]["journalDate"], serde_json::Value::Null);
    }

    #[test]
    fn bad_input_is_reported_rather_than_panicking() {
        // Each of the three parse steps on this boundary, since a local garden
        // feeds all of them from JS where the types are not checked.
        assert!(extract_tags_impl("not json").is_err());
        assert!(extract_tasks_impl("not json", &journal_type_json(), None).is_err());
        assert!(extract_tasks_impl(&page_json(), "not json", None).is_err());
        assert!(extract_tasks_impl(&page_json(), &journal_type_json(), Some("29/10/2026")).is_err());
    }
}


#[cfg(test)]
mod page_update_tests {
    use super::*;

    const UUID_A: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const UUID_B: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    fn empty_page() -> String {
        serde_json::to_string(&Page::new("Shopping")).unwrap()
    }

    fn blocks_json() -> String {
        serde_json::json!([
            { "uuid": UUID_A, "content": "milk", "parent_uuid": null, "children": [UUID_B], "collapsed": false, "properties": {} },
            { "uuid": UUID_B, "content": "oat", "parent_uuid": UUID_A, "children": [], "collapsed": false, "properties": {} },
        ])
        .to_string()
    }

    #[test]
    fn a_save_replaces_the_blocks_and_bumps_the_version() {
        let saved = apply_block_updates_impl(&empty_page(), &blocks_json(), Some(1)).unwrap();
        let page: Page = serde_json::from_str(&saved).unwrap();
        assert_eq!(page.blocks.len(), 2);
        assert_eq!(page.root_blocks.len(), 1, "only the parent is a root");
        assert_eq!(page.version, 2);
        assert_eq!(page.blocks[&UUID_A.parse().unwrap()].content, "milk");
    }

    #[test]
    fn a_stale_save_reports_the_current_version() {
        let err = apply_block_updates_impl(&empty_page(), &blocks_json(), Some(7)).unwrap_err();
        assert!(
            err.contains("current 1"),
            "the caller needs the current version to raise a conflict: {err}"
        );
    }

    #[test]
    fn properties_are_set_and_removed() {
        let mut page = Page::new("Shopping");
        page.properties.insert("readonly".to_string(), "true".to_string());
        let json = serde_json::to_string(&page).unwrap();

        let updated = apply_property_updates_impl(&json, r#"{"longform":"true","readonly":null}"#).unwrap();
        let page: Page = serde_json::from_str(&updated).unwrap();
        assert_eq!(page.properties.get("longform"), Some(&"true".to_string()));
        assert!(!page.properties.contains_key("readonly"));
    }

    #[test]
    fn a_template_is_copied_with_a_cursor() {
        let mut template = Page::new("template");
        template.add_block(tend_core::Block::new("TODO {{cursor}}"));
        let instantiated = instantiate_template_impl(
            &serde_json::to_string(&template).unwrap(),
            &empty_page(),
        )
        .unwrap();

        let value: serde_json::Value = serde_json::from_str(&instantiated).unwrap();
        let page: Page = serde_json::from_value(value["page"].clone()).unwrap();
        assert_eq!(page.blocks.len(), 1);
        let block = page.blocks.values().next().unwrap();
        assert_eq!(block.content, "TODO ", "the marker is removed");

        assert_eq!(value["cursorPosition"]["offset"], 5);
        assert_eq!(
            value["cursorPosition"]["blockUuid"],
            block.uuid.to_string(),
            "the cursor names the block in the NEW page"
        );
    }

    #[test]
    fn a_template_with_no_marker_has_no_cursor() {
        let mut template = Page::new("template");
        template.add_block(tend_core::Block::new("just a heading"));
        let instantiated = instantiate_template_impl(
            &serde_json::to_string(&template).unwrap(),
            &empty_page(),
        )
        .unwrap();
        let value: serde_json::Value = serde_json::from_str(&instantiated).unwrap();
        assert!(value["cursorPosition"].is_null());
    }

    #[test]
    fn strip_cursor_marker_reports_the_offset_or_nothing() {
        let tracked: serde_json::Value =
            serde_json::from_str(&strip_cursor_marker_impl("a {{cursor}}b", true).unwrap()).unwrap();
        assert_eq!(tracked["content"], "a b");
        assert_eq!(tracked["offset"], 2);

        let untracked: serde_json::Value =
            serde_json::from_str(&strip_cursor_marker_impl("a {{cursor}}b", false).unwrap()).unwrap();
        assert_eq!(untracked["content"], "a b", "the marker still goes");
        assert!(untracked["offset"].is_null());
    }

    #[test]
    fn bad_page_input_is_reported_rather_than_panicking() {
        assert!(apply_block_updates_impl("not json", &blocks_json(), None).is_err());
        assert!(apply_block_updates_impl(&empty_page(), "not json", None).is_err());
        assert!(apply_block_updates_impl(&empty_page(), r#"[{"uuid":"nope","content":"","parent_uuid":null,"children":[],"collapsed":false,"properties":{}}]"#, None).is_err());
        assert!(apply_property_updates_impl(&empty_page(), "not json").is_err());
        assert!(instantiate_template_impl("not json", &empty_page()).is_err());
    }
}

#[cfg(test)]
mod sheet_path_tests {
    use super::*;

    fn note_type_json() -> String {
        let mut ct = tend_core::ContentType::page();
        ct.id = "note".to_string();
        ct.directory = "notes".to_string();
        serde_json::to_string(&ct).unwrap()
    }

    fn meeting_type_json() -> String {
        let mut ct = tend_core::ContentType::page();
        ct.id = "meeting".to_string();
        ct.directory = "meetings".to_string();
        ct.organization = tend_core::Organization::DateFoldered;
        serde_json::to_string(&ct).unwrap()
    }

    fn segments(json: &str) -> Vec<String> {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn a_sheet_path_is_segments_in_both_extensions() {
        assert_eq!(
            segments(&sheet_rel_path_impl(&note_type_json(), "A:B", None, false, true).unwrap()),
            vec!["notes", "A%3AB.md"]
        );
        assert_eq!(
            segments(&sheet_rel_path_impl(&note_type_json(), "A:B", None, true, true).unwrap()),
            vec!["notes", "A%3AB.md.age"]
        );
        assert_eq!(
            segments(&sheet_rel_path_impl(&note_type_json(), "A:B", None, false, false).unwrap()),
            vec!["notes", "A:B.md"],
            "the legacy un-encoded form is still readable"
        );
        assert_eq!(
            segments(
                &sheet_rel_path_impl(&meeting_type_json(), "Standup", Some("2025-01-18"), false, true)
                    .unwrap()
            ),
            vec!["meetings", "2025-01-18", "Standup.md"]
        );
    }

    #[test]
    fn sheet_ref_reads_a_filename_back() {
        let found: serde_json::Value = serde_json::from_str(
            &sheet_ref_impl(&note_type_json(), "[]", "A%3AB.md", false).unwrap(),
        )
        .unwrap();
        assert_eq!(found["name"], "A:B");
        assert!(found["date"].is_null());

        let dated: serde_json::Value = serde_json::from_str(
            &sheet_ref_impl(&meeting_type_json(), r#"["2025-01-18"]"#, "Standup.md", false).unwrap(),
        )
        .unwrap();
        assert_eq!(dated["name"], "Standup");
        assert_eq!(dated["date"], "2025-01-18");
    }

    #[test]
    fn a_file_of_another_shape_comes_back_null() {
        let value: serde_json::Value =
            serde_json::from_str(&sheet_ref_impl(&note_type_json(), "[]", "notes.txt", false).unwrap())
                .unwrap();
        assert!(value.is_null());
    }

    #[test]
    fn metadata_matches_what_a_journal_listing_shows() {
        let journal = serde_json::to_string(&tend_core::ContentType::journal()).unwrap();
        let meta: tend_core::PageMeta = serde_json::from_str(
            &sheet_meta_impl(&journal, "2025-01-18", None, 3, 0, 0).unwrap(),
        )
        .unwrap();
        assert_eq!(meta.title, "Saturday, January 18, 2025");
        assert!(meta.is_journal);
        assert_eq!(meta.block_count, 3);
        assert_eq!(
            meta.journal_date,
            chrono::NaiveDate::from_ymd_opt(2025, 1, 18)
        );

        let light: tend_core::PageMeta =
            serde_json::from_str(&sheet_ref_meta_impl(&journal, "2025-01-18", None).unwrap()).unwrap();
        assert_eq!(light.name, meta.name, "both agree on the qualified name");
        assert_eq!(light.block_count, 0, "a name-only listing counts nothing");
    }

    #[test]
    fn a_listing_sorts_newest_first() {
        let journal = serde_json::to_string(&tend_core::ContentType::journal()).unwrap();
        let older = sheet_meta_impl(&journal, "2025-01-18", None, 0, 0, 0).unwrap();
        let newer = sheet_meta_impl(&journal, "2025-03-01", None, 0, 0, 0).unwrap();
        let listing = format!("[{older},{newer}]");

        let sorted: Vec<tend_core::PageMeta> =
            serde_json::from_str(&sort_sheets_impl(&listing, &journal).unwrap()).unwrap();
        assert_eq!(sorted[0].name, "2025-03-01");
    }

    #[test]
    fn bad_path_input_is_reported_rather_than_panicking() {
        assert!(sheet_rel_path_impl("not json", "A", None, false, true).is_err());
        assert!(
            sheet_rel_path_impl(&meeting_type_json(), "A", Some("18/01/2025"), false, true).is_err()
        );
        assert!(sheet_ref_impl(&note_type_json(), "not json", "A.md", false).is_err());
        assert!(sheet_meta_impl(&note_type_json(), "A", None, 0, i64::MAX, 0).is_err());
        assert!(sort_sheets_impl("not json", &note_type_json()).is_err());
    }
}
