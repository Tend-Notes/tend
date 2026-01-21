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
//! The following are NOT encrypted:
//! - `.tend/search_index/` - Search index (can be rebuilt from encrypted files)
//! - `.git/` - Git repository (stores encrypted `.age` blobs)
//!
//! Note: The search index contains text snippets for search results. For maximum
//! security, delete the `.tend/` directory when not using the garden. It will be
//! rebuilt on next startup.
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

use age::secrecy::SecretString;
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
