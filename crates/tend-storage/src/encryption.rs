// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Age-based encryption for garden files
//!
//! This module provides transparent encryption/decryption of markdown files
//! using the age encryption format. Files are encrypted with a passphrase
//! and can be recovered using the standard `age` CLI tool.
//!
//! # What gets encrypted
//!
//! Only user content files are encrypted:
//! - `pages/*.md` → `pages/*.md.age`
//! - `journals/*.md` → `journals/*.md.age`
//!
//! For encrypted gardens the search index and the link/tag (backlink) index are
//! kept in memory only — built on unlock, dropped on lock — so they are never
//! written to disk in plaintext. The `.git/` repository stores only the
//! encrypted `.age` blobs, and nothing under `.tend/` is pushed to a remote.
//!
//! The only at-rest exposure is filenames: page names remain visible as
//! `pages/<name>.md.age` / `journals/<name>.md.age` in the filesystem.
//!
//! # Recovery outside Tend
//!
//! Encrypted files use the standard age format and can be decrypted with:
//! ```bash
//! age -d -o decrypted.md encrypted.md.age
//! ```
//!
//! To decrypt an entire garden:
//! ```bash
//! cd /path/to/garden
//! for f in pages/*.age journals/*.age; do
//!   age -d -o "${f%.age}" "$f"
//! done
//! ```

use std::str::FromStr;

use age::secrecy::{ExposeSecret, SecretString};
use age::x25519;
use thiserror::Error;
use tracing::debug;

/// Errors that can occur during encryption operations
#[derive(Debug, Error)]
pub enum EncryptionError {
    #[error("Encryption failed: {0}")]
    EncryptionFailed(String),

    #[error("Decryption failed: {0}")]
    DecryptionFailed(String),

    #[error("Wrong passphrase")]
    WrongPassphrase,

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

/// Encrypt content using age with a passphrase.
///
/// The output is in the standard age format and can be decrypted
/// using the `age` CLI tool with the same passphrase.
pub fn encrypt(content: &str, passphrase: &str) -> Result<Vec<u8>, EncryptionError> {
    let recipient = age::scrypt::Recipient::new(SecretString::from(passphrase.to_string()));

    let encrypted = age::encrypt(&recipient, content.as_bytes())
        .map_err(|e| EncryptionError::EncryptionFailed(e.to_string()))?;

    debug!(
        "Encrypted {} bytes to {} bytes",
        content.len(),
        encrypted.len()
    );

    Ok(encrypted)
}

/// Decrypt content that was encrypted with age passphrase encryption.
///
/// Returns the decrypted content as a UTF-8 string.
pub fn decrypt(encrypted: &[u8], passphrase: &str) -> Result<String, EncryptionError> {
    let identity = age::scrypt::Identity::new(SecretString::from(passphrase.to_string()));

    let decrypted = age::decrypt(&identity, encrypted).map_err(|e| match e {
        age::DecryptError::DecryptionFailed => EncryptionError::WrongPassphrase,
        _ => EncryptionError::DecryptionFailed(e.to_string()),
    })?;

    let content = String::from_utf8(decrypted)
        .map_err(|e| EncryptionError::DecryptionFailed(format!("Invalid UTF-8: {}", e)))?;

    debug!("Decrypted {} bytes", content.len());

    Ok(content)
}

// ============================================================================
// Per-garden X25519 identity (SEC-25 Part B)
//
// Passphrase-scrypt encryption re-runs the scrypt KDF (~1-2s) on *every* file,
// because age generates a fresh salt per file. To make unlock and reads fast we
// give each garden a random X25519 identity, wrap its secret key *once* behind
// the passphrase (scrypt runs a single time), and encrypt note files to that
// identity — X25519 has no per-file KDF. The wrapped identity is standard age
// ciphertext, and the note files are standard age X25519 files, so both remain
// decryptable with the `age` CLI.
// ============================================================================

/// Generate a fresh, random per-garden X25519 identity.
pub fn generate_identity() -> x25519::Identity {
    x25519::Identity::generate()
}

/// Encrypt `content` to an X25519 recipient. No per-file KDF — fast.
pub fn encrypt_to_recipient(
    content: &str,
    recipient: &x25519::Recipient,
) -> Result<Vec<u8>, EncryptionError> {
    age::encrypt(recipient, content.as_bytes())
        .map_err(|e| EncryptionError::EncryptionFailed(e.to_string()))
}

/// Decrypt `encrypted` with an X25519 identity. No per-file KDF — fast.
///
/// Returns an error (rather than panicking) when the ciphertext is not for this
/// identity — e.g. a legacy passphrase-scrypt file — so callers can fall back.
pub fn decrypt_with_identity(
    encrypted: &[u8],
    identity: &x25519::Identity,
) -> Result<String, EncryptionError> {
    let decrypted = age::decrypt(identity, encrypted)
        .map_err(|e| EncryptionError::DecryptionFailed(e.to_string()))?;
    String::from_utf8(decrypted)
        .map_err(|e| EncryptionError::DecryptionFailed(format!("Invalid UTF-8: {}", e)))
}

/// Wrap an identity's secret key behind the passphrase (scrypt runs once here)
/// for on-disk storage. Output is standard age-scrypt ciphertext.
pub fn wrap_identity(
    identity: &x25519::Identity,
    passphrase: &str,
) -> Result<Vec<u8>, EncryptionError> {
    encrypt(identity.to_string().expose_secret(), passphrase)
}

/// Unwrap a stored identity with the passphrase (scrypt runs once here). A wrong
/// passphrase yields [`EncryptionError::WrongPassphrase`].
pub fn unwrap_identity(
    wrapped: &[u8],
    passphrase: &str,
) -> Result<x25519::Identity, EncryptionError> {
    let secret = decrypt(wrapped, passphrase)?;
    x25519::Identity::from_str(secret.trim())
        .map_err(|e| EncryptionError::DecryptionFailed(format!("Invalid identity key: {}", e)))
}

/// Check if data looks like an age-encrypted file.
///
/// Age files start with the ASCII armor header "age-encryption.org/v1"
/// or the binary header.
pub fn is_age_encrypted(data: &[u8]) -> bool {
    // ASCII armor header
    if data.starts_with(b"age-encryption.org/v1") {
        return true;
    }
    // Binary header (age magic bytes)
    if data.starts_with(b"age-encryption.org") {
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let content = "Hello, world!\nThis is a test.\n- Bullet point";
        let passphrase = "test-passphrase-123";

        let encrypted = encrypt(content, passphrase).unwrap();
        assert!(is_age_encrypted(&encrypted));

        let decrypted = decrypt(&encrypted, passphrase).unwrap();
        assert_eq!(decrypted, content);
    }

    #[test]
    fn test_wrong_passphrase() {
        let content = "Secret content";
        let correct_passphrase = "correct";
        let wrong_passphrase = "wrong";

        let encrypted = encrypt(content, correct_passphrase).unwrap();

        let result = decrypt(&encrypted, wrong_passphrase);
        assert!(matches!(result, Err(EncryptionError::WrongPassphrase)));
    }

    #[test]
    fn test_identity_encrypt_decrypt_roundtrip() {
        let identity = generate_identity();
        let recipient = identity.to_public();
        let content = "Fast path content\n- no per-file scrypt";

        let encrypted = encrypt_to_recipient(content, &recipient).unwrap();
        assert!(is_age_encrypted(&encrypted));
        assert_eq!(decrypt_with_identity(&encrypted, &identity).unwrap(), content);
    }

    #[test]
    fn test_wrap_unwrap_identity_roundtrip() {
        let identity = generate_identity();
        let passphrase = "garden-passphrase";

        let wrapped = wrap_identity(&identity, passphrase).unwrap();
        assert!(is_age_encrypted(&wrapped));
        let unwrapped = unwrap_identity(&wrapped, passphrase).unwrap();

        // Same identity: content encrypted to the original recipient decrypts
        // with the unwrapped identity.
        let ct = encrypt_to_recipient("hi", &identity.to_public()).unwrap();
        assert_eq!(decrypt_with_identity(&ct, &unwrapped).unwrap(), "hi");
    }

    #[test]
    fn test_unwrap_identity_wrong_passphrase() {
        let identity = generate_identity();
        let wrapped = wrap_identity(&identity, "right").unwrap();
        assert!(matches!(
            unwrap_identity(&wrapped, "wrong"),
            Err(EncryptionError::WrongPassphrase)
        ));
    }

    #[test]
    fn test_empty_content() {
        let content = "";
        let passphrase = "test";

        let encrypted = encrypt(content, passphrase).unwrap();
        let decrypted = decrypt(&encrypted, passphrase).unwrap();
        assert_eq!(decrypted, content);
    }

    #[test]
    fn test_unicode_content() {
        let content = "日本語テスト 🌱 émojis and ünïcödé";
        let passphrase = "パスワード";

        let encrypted = encrypt(content, passphrase).unwrap();
        let decrypted = decrypt(&encrypted, passphrase).unwrap();
        assert_eq!(decrypted, content);
    }

    #[test]
    fn test_is_age_encrypted() {
        assert!(!is_age_encrypted(b"- Regular markdown content"));
        assert!(!is_age_encrypted(b""));
        assert!(is_age_encrypted(b"age-encryption.org/v1\n"));
    }
}
