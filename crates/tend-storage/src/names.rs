// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Filename encoding and name validation.
//!
//! Split out of `fs.rs` because these are pure string functions with no
//! filesystem or async dependencies, which lets the wasm bridge reuse the exact
//! same encoding the server writes with — a browser-written garden has to be
//! byte-identical to a server-written one.

use crate::error::StorageError;

/// Characters that are unsafe in filenames across platforms (particularly Windows).
/// These are percent-encoded when constructing filesystem paths.
const UNSAFE_FILENAME_CHARS: &[char] = &['%', ':', '<', '>', '"', '|', '?', '*', '\\'];

/// Encode a page/sheet name for use as a filename.
/// Percent-encodes characters that are unsafe on some platforms.
pub fn encode_filename(name: &str) -> String {
    let mut result = String::with_capacity(name.len());
    for ch in name.chars() {
        if ch == '%' {
            result.push_str("%25");
        } else if UNSAFE_FILENAME_CHARS.contains(&ch) || ch.is_control() {
            let mut buf = [0u8; 4];
            for byte in ch.encode_utf8(&mut buf).bytes() {
                result.push_str(&format!("%{:02X}", byte));
            }
        } else {
            result.push(ch);
        }
    }
    result
}

/// Decode a filename back to the original page/sheet name.
/// Reverses the percent-encoding applied by `encode_filename`.
///
/// Decoding collects BYTES and interprets them as UTF-8 at the end. Doing it
/// per-byte with `byte as char` (as this used to) is a Latin-1 mapping, which
/// mangles every multi-byte character — both ones that pass through unencoded
/// and ones `encode_filename` split into several `%XX` escapes.
pub fn decode_filename(encoded: &str) -> String {
    let mut bytes_out: Vec<u8> = Vec::with_capacity(encoded.len());
    let bytes = encoded.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex_str) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(byte_val) = u8::from_str_radix(hex_str, 16) {
                    bytes_out.push(byte_val);
                    i += 3;
                    continue;
                }
            }
        }
        bytes_out.push(bytes[i]);
        i += 1;
    }
    // Lossy: a filename that is not valid UTF-8 is a corrupt name, not a crash.
    String::from_utf8_lossy(&bytes_out).into_owned()
}

/// Validates that a name is safe for use in file paths.
/// Rejects path traversal attempts, absolute paths, and null bytes.
pub fn validate_safe_name(name: &str) -> Result<(), StorageError> {
    if name.is_empty() {
        return Err(StorageError::InvalidPath("Name cannot be empty".into()));
    }
    if name.contains("..") {
        return Err(StorageError::InvalidPath("Name cannot contain '..'".into()));
    }
    if name.starts_with('/') || name.starts_with('\\') {
        return Err(StorageError::InvalidPath("Name cannot be an absolute path".into()));
    }
    if name.contains('\0') {
        return Err(StorageError::InvalidPath("Name cannot contain null bytes".into()));
    }
    if name.chars().any(|c| c.is_control()) {
        return Err(StorageError::InvalidPath(
            "Name cannot contain control characters".into(),
        ));
    }
    Ok(())
}
