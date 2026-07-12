// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Encrypted file system operations for Tend
//!
//! Wraps FileManager to provide transparent encryption/decryption of markdown files
//! using age encryption.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::NaiveDate;
use secrecy::{ExposeSecret, SecretString};
use tend_core::parser::{parse_journal_filename, parse_markdown};
use tend_core::serializer::serialize_page;
use tend_core::{ContentType, Page, PageMeta};
use tokio::sync::RwLock;
use tracing::{debug, info};

use age::x25519;

use crate::encryption::{
    decrypt, decrypt_with_identity, encrypt_to_recipient, generate_identity, unwrap_identity,
    wrap_identity, EncryptionError,
};
use crate::error::StorageError;
use crate::fs::{decode_filename, encode_filename, validate_safe_name};

/// File extension for encrypted files
const ENCRYPTED_EXT: &str = "md.age";

/// On-disk location (under the garden) of the passphrase-wrapped X25519 identity.
const IDENTITY_FILE: &str = "identity.age";

/// Manages encrypted file operations for a garden
pub struct EncryptedFileManager {
    /// Root path of the garden
    root: PathBuf,

    /// Passphrase (held in memory, zeroized on drop). Retained to unwrap the
    /// identity and to read/migrate any legacy passphrase-scrypt files.
    passphrase: SecretString,

    /// Per-garden X25519 identity, unwrapped once at unlock. Note files are
    /// encrypted/decrypted with this (no per-file scrypt). Held in memory only;
    /// age's `Identity` zeroizes its secret on drop, so it is cleared on
    /// lock/garden-switch/drop along with the manager (SEC-19).
    identity: x25519::Identity,

    /// Public recipient derived from `identity`, for encrypting note files.
    recipient: x25519::Recipient,

    /// Lock for write operations
    write_lock: Arc<RwLock<()>>,

    /// Set of paths we're currently writing
    pending_writes: Arc<RwLock<HashSet<PathBuf>>>,
}

impl EncryptedFileManager {
    /// Create a new EncryptedFileManager for an encrypted garden
    pub fn new(root: impl AsRef<Path>, passphrase: String) -> Result<Self, StorageError> {
        let root = root.as_ref().to_path_buf();

        // Ensure directories exist
        std::fs::create_dir_all(root.join("pages"))?;
        std::fs::create_dir_all(root.join("journals"))?;
        // Restrict the garden tree so other local users can't read ciphertext.
        crate::fs::restrict_dir(&root);
        crate::fs::restrict_dir(&root.join("pages"));
        crate::fs::restrict_dir(&root.join("journals"));

        let passphrase = SecretString::from(passphrase);

        // Load the garden's X25519 identity (unwrap with the passphrase —
        // scrypt runs once here), or mint one on first unlock.
        let identity = Self::load_or_create_identity(&root, passphrase.expose_secret())?;
        let recipient = identity.to_public();

        info!("Initialized encrypted garden at: {}", root.display());

        Ok(Self {
            root,
            passphrase,
            identity,
            recipient,
            write_lock: Arc::new(RwLock::new(())),
            pending_writes: Arc::new(RwLock::new(HashSet::new())),
        })
    }

    /// Load the garden's wrapped X25519 identity, or create and store one.
    ///
    /// The identity file is standard age-scrypt ciphertext wrapping the identity
    /// secret; unwrapping it runs scrypt exactly once per unlock. When absent
    /// (a fresh garden, or a legacy garden being migrated), a new identity is
    /// generated and stored — but only after the passphrase is verified against
    /// the existing `encryption.verify`, so a wrong passphrase can't mint a bad
    /// identity.
    fn load_or_create_identity(
        root: &Path,
        passphrase: &str,
    ) -> Result<x25519::Identity, StorageError> {
        let identity_path = root.join(".tend").join(IDENTITY_FILE);

        if identity_path.exists() {
            let wrapped = std::fs::read(&identity_path)?;
            // Unwrapping is also the passphrase check (scrypt runs once here).
            return unwrap_identity(&wrapped, passphrase).map_err(|e| match e {
                EncryptionError::WrongPassphrase => {
                    StorageError::Other("Invalid passphrase".to_string())
                }
                other => StorageError::Other(format!("Failed to unwrap identity: {}", other)),
            });
        }

        // No identity yet. If a verification file exists (legacy or freshly
        // created garden), the passphrase must decrypt it before we mint an
        // identity — otherwise a wrong passphrase would write an identity that
        // no correct passphrase could ever unwrap.
        let verify_path = root.join(".tend").join("encryption.verify");
        if verify_path.exists() {
            let verify = std::fs::read(&verify_path)?;
            decrypt(&verify, passphrase)
                .map_err(|_| StorageError::Other("Invalid passphrase".into()))?;
        }

        let identity = generate_identity();
        let wrapped = wrap_identity(&identity, passphrase)
            .map_err(|e| StorageError::Other(format!("Failed to wrap identity: {}", e)))?;
        if let Some(parent) = identity_path.parent() {
            std::fs::create_dir_all(parent)?;
            crate::fs::restrict_dir(parent);
        }
        std::fs::write(&identity_path, wrapped)?;
        crate::fs::restrict_file(&identity_path);
        info!("Minted X25519 identity for encrypted garden: {}", root.display());

        Ok(identity)
    }

    /// Decrypt a note file, preferring the fast X25519 identity and falling back
    /// to the legacy passphrase-scrypt path for files not yet migrated.
    fn decrypt_file(&self, encrypted: &[u8]) -> Result<String, StorageError> {
        match decrypt_with_identity(encrypted, &self.identity) {
            Ok(content) => Ok(content),
            Err(_) => decrypt(encrypted, self.passphrase.expose_secret()).map_err(|e| match e {
                EncryptionError::WrongPassphrase => {
                    StorageError::Other("Wrong passphrase".to_string())
                }
                _ => StorageError::Other(format!("Decryption failed: {}", e)),
            }),
        }
    }

    /// Re-encrypt any legacy passphrase-scrypt note files to the garden's
    /// X25519 identity (eager migration). Runs once, right after unlock; after
    /// it every file decrypts without scrypt. Returns the number migrated.
    ///
    /// Idempotent: files already encrypted to the identity are skipped, so this
    /// is a cheap no-op on an already-migrated garden.
    pub async fn migrate_to_identity(&self) -> Result<usize, StorageError> {
        let _guard = self.write_lock.write().await;
        let mut migrated = 0usize;
        let mut dirs = vec![self.root.join("pages"), self.root.join("journals")];

        while let Some(dir) = dirs.pop() {
            let Ok(mut entries) = tokio::fs::read_dir(&dir).await else {
                continue;
            };
            while let Some(entry) = entries.next_entry().await? {
                let path = entry.path();
                if path.is_dir() {
                    dirs.push(path);
                    continue;
                }
                let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
                    continue;
                };
                if !name.ends_with(ENCRYPTED_EXT) {
                    continue;
                }
                let data = tokio::fs::read(&path).await?;
                // Already identity-encrypted -> nothing to do.
                if decrypt_with_identity(&data, &self.identity).is_ok() {
                    continue;
                }
                // Legacy scrypt file: decrypt with the passphrase (one scrypt,
                // one time) and re-encrypt to the identity.
                let content = match decrypt(&data, self.passphrase.expose_secret()) {
                    Ok(c) => c,
                    Err(e) => {
                        debug!("Skipping unreadable file during migration {}: {}", path.display(), e);
                        continue;
                    }
                };
                let reencrypted = encrypt_to_recipient(&content, &self.recipient)
                    .map_err(|e| StorageError::Other(format!("Re-encryption failed: {}", e)))?;
                let tmp = path.with_extension("migrating");
                tokio::fs::write(&tmp, &reencrypted).await?;
                tokio::fs::rename(&tmp, &path).await?;
                crate::fs::restrict_file(&path);
                migrated += 1;
            }
        }

        if migrated > 0 {
            info!(
                "Migrated {} legacy file(s) to X25519 identity in {}",
                migrated,
                self.root.display()
            );
        }
        Ok(migrated)
    }

    /// Verify the passphrase is correct by decrypting the verification file
    pub fn verify_passphrase(root: impl AsRef<Path>, passphrase: &str) -> Result<bool, StorageError> {
        let verify_path = root.as_ref().join(".tend").join("encryption.verify");

        if !verify_path.exists() {
            return Err(StorageError::Other(
                "Encryption verification file not found".to_string(),
            ));
        }

        let encrypted = std::fs::read(&verify_path)?;

        match decrypt(&encrypted, passphrase) {
            Ok(content) => {
                if content == "tend-encryption-verification" {
                    Ok(true)
                } else {
                    Ok(false)
                }
            }
            Err(EncryptionError::WrongPassphrase) => Ok(false),
            Err(e) => Err(StorageError::Other(format!(
                "Failed to verify passphrase: {}",
                e
            ))),
        }
    }

    /// Get the root path
    pub fn root(&self) -> &Path {
        &self.root
    }


    /// Check if a path is one we're currently writing
    pub async fn is_pending_write(&self, path: &Path) -> bool {
        self.pending_writes.read().await.contains(path)
    }

    /// Get a reference to pending writes for the watcher
    pub fn pending_writes(&self) -> Arc<RwLock<HashSet<PathBuf>>> {
        Arc::clone(&self.pending_writes)
    }

    /// List all encrypted pages (thin wrapper over the unified sheet path).
    pub async fn list_pages(&self) -> Result<Vec<PageMeta>, StorageError> {
        self.list_sheets(&ContentType::page()).await
    }

    /// List all encrypted journals (thin wrapper over the unified sheet path).
    pub async fn list_journals(&self) -> Result<Vec<PageMeta>, StorageError> {
        self.list_sheets(&ContentType::journal()).await
    }

    /// Read and decrypt a page by name (thin wrapper over the unified sheet path).
    pub async fn read_page(&self, name: &str) -> Result<Page, StorageError> {
        self.read_sheet(&ContentType::page(), name, None).await
    }

    /// Read and decrypt a journal by date (thin wrapper over the unified sheet path).
    pub async fn read_journal(&self, date: NaiveDate) -> Result<Page, StorageError> {
        let name = date.format("%Y-%m-%d").to_string();
        self.read_sheet(&ContentType::journal(), &name, None).await
    }

    /// Encrypt and write a page or journal (thin wrapper over the unified sheet path).
    pub async fn write_page(&self, page: &Page) -> Result<(), StorageError> {
        let content_type = if page.is_journal {
            ContentType::journal()
        } else {
            ContentType::page()
        };
        self.write_sheet(&content_type, page, page.journal_date).await
    }

    /// Encrypt and write a page to a specific path
    async fn write_file(&self, path: &Path, page: &Page) -> Result<(), StorageError> {
        // Acquire read lock
        let _guard = self.write_lock.read().await;

        let content = serialize_page(page);
        // Encrypt to the garden's X25519 recipient (no per-file scrypt).
        let encrypted = encrypt_to_recipient(&content, &self.recipient)
            .map_err(|e| StorageError::Other(format!("Encryption failed: {}", e)))?;

        let tmp_path = path.with_extension("tmp");

        // Mark as pending write
        {
            let mut pending = self.pending_writes.write().await;
            pending.insert(path.to_path_buf());
        }

        // Write encrypted content to temp file
        tokio::fs::write(&tmp_path, &encrypted).await?;

        // Atomic rename
        tokio::fs::rename(&tmp_path, path).await?;

        // Remove from pending writes after a delay to ensure file watcher
        // events are properly ignored. Using 1000ms for consistency with fs.rs.
        let pending_writes = Arc::clone(&self.pending_writes);
        let path_buf = path.to_path_buf();
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
            let mut pending = pending_writes.write().await;
            pending.remove(&path_buf);
        });

        debug!("Wrote encrypted page: {}", path.display());

        Ok(())
    }

    /// Delete an encrypted page (thin wrapper over the unified sheet path).
    pub async fn delete_page(&self, name: &str) -> Result<(), StorageError> {
        self.delete_sheet(&ContentType::page(), name, None).await
    }

    /// Check if an encrypted page exists (thin wrapper over the unified sheet path).
    pub async fn page_exists(&self, name: &str) -> bool {
        self.sheet_exists(&ContentType::page(), name, None).await
    }

    /// Check if an encrypted journal exists (thin wrapper over the unified sheet path).
    pub async fn journal_exists(&self, date: NaiveDate) -> bool {
        let name = date.format("%Y-%m-%d").to_string();
        self.sheet_exists(&ContentType::journal(), &name, None).await
    }

    /// Acquire exclusive lock (for git backup)
    pub async fn acquire_exclusive_lock(&self) -> tokio::sync::RwLockWriteGuard<'_, ()> {
        info!("Acquiring exclusive lock for backup");
        self.write_lock.write().await
    }

    // ========== Sheet (Content Type) Operations ==========

    /// Get path to an encrypted sheet file for a content type
    fn sheet_path(&self, content_type: &ContentType, name: &str, date: Option<NaiveDate>) -> PathBuf {
        let dir = self.root.join(&content_type.directory);
        if content_type.is_date_foldered() {
            let d = date.unwrap_or_else(|| chrono::Local::now().date_naive());
            dir.join(d.format("%Y-%m-%d").to_string())
                .join(format!("{}.{}", encode_filename(name), ENCRYPTED_EXT))
        } else {
            dir.join(format!("{}.{}", encode_filename(name), ENCRYPTED_EXT))
        }
    }

    /// Raw (unencoded) sheet path for backwards compatibility
    fn raw_sheet_path(&self, content_type: &ContentType, name: &str, date: Option<NaiveDate>) -> PathBuf {
        let dir = self.root.join(&content_type.directory);
        if content_type.is_date_foldered() {
            let d = date.unwrap_or_else(|| chrono::Local::now().date_naive());
            dir.join(d.format("%Y-%m-%d").to_string())
                .join(format!("{}.{}", name, ENCRYPTED_EXT))
        } else {
            dir.join(format!("{}.{}", name, ENCRYPTED_EXT))
        }
    }

    /// Ensure content type directory exists
    pub async fn ensure_content_type_dir(&self, content_type: &ContentType, date: Option<NaiveDate>) -> Result<(), StorageError> {
        let dir = if content_type.is_date_foldered() {
            let d = date.unwrap_or_else(|| chrono::Local::now().date_naive());
            self.root.join(&content_type.directory).join(d.format("%Y-%m-%d").to_string())
        } else {
            self.root.join(&content_type.directory)
        };
        tokio::fs::create_dir_all(&dir).await?;
        crate::fs::restrict_dir(&dir);
        Ok(())
    }

    /// List all encrypted sheets of a content type (one code path, driven by `organization`).
    pub async fn list_sheets(&self, content_type: &ContentType) -> Result<Vec<PageMeta>, StorageError> {
        let mut sheets: Vec<PageMeta> = self
            .collect_sheets(content_type)
            .await?
            .iter()
            .map(PageMeta::from)
            .collect();

        if content_type.is_date_named() {
            sheets.sort_by_key(|a| std::cmp::Reverse(a.journal_date));
        } else {
            sheets.sort_by_key(|a| std::cmp::Reverse(a.modified_at));
        }
        Ok(sheets)
    }

    /// Load every sheet of a content type as a fully decrypted `Page`.
    ///
    /// Unlike `list_sheets` (which decrypts each file only to derive its
    /// `PageMeta` and then discards the `Page`), this returns the decrypted
    /// pages directly — one decrypt per file. Callers that need the page bodies
    /// (e.g. rebuilding every index at once on unlock) use this so a page is
    /// decrypted a single time instead of once per index. Order is unspecified.
    pub async fn load_all_sheets(&self, content_type: &ContentType) -> Result<Vec<Page>, StorageError> {
        self.collect_sheets(content_type).await
    }

    /// Walk a content type's directory and decrypt every sheet exactly once.
    /// Walk a content type's directory and derive each sheet's (bare name,
    /// date) from its FILENAME only — no file reads or decrypts. Filenames
    /// aren't encrypted, so this is cheap even for encrypted gardens.
    async fn collect_sheet_refs(
        &self,
        content_type: &ContentType,
    ) -> Result<Vec<(String, Option<NaiveDate>)>, StorageError> {
        let base_dir = self.root.join(&content_type.directory);

        if !base_dir.exists() {
            return Ok(Vec::new());
        }

        let mut refs = Vec::new();
        let ext_suffix = format!(".{}", ENCRYPTED_EXT);

        if content_type.is_date_foldered() {
            let mut date_dirs = tokio::fs::read_dir(&base_dir).await?;
            while let Some(date_entry) = date_dirs.next_entry().await? {
                let date_path = date_entry.path();
                if date_path.is_dir() {
                    let date = date_path
                        .file_name()
                        .and_then(|s| s.to_str())
                        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());

                    let mut entries = tokio::fs::read_dir(&date_path).await?;
                    while let Some(entry) = entries.next_entry().await? {
                        let path = entry.path();
                        if let Some(filename) = path.file_name().and_then(|s| s.to_str()) {
                            if let Some(raw_name) = filename.strip_suffix(&ext_suffix) {
                                refs.push((decode_filename(raw_name), date));
                            }
                        }
                    }
                }
            }
        } else {
            let mut entries = tokio::fs::read_dir(&base_dir).await?;
            while let Some(entry) = entries.next_entry().await? {
                let path = entry.path();
                let Some(filename) = path.file_name().and_then(|s| s.to_str()) else {
                    continue;
                };
                if !filename.ends_with(&ext_suffix) {
                    continue;
                }
                // Date-named types (journals): "YYYY-MM-DD.md.age" -> base "YYYY-MM-DD.md".
                let name = if content_type.is_date_named() {
                    let Some(base) = filename.strip_suffix(".age") else {
                        continue;
                    };
                    match parse_journal_filename(base) {
                        Some(d) => d.format("%Y-%m-%d").to_string(),
                        None => continue,
                    }
                } else {
                    let Some(raw_name) = filename.strip_suffix(&ext_suffix) else {
                        continue;
                    };
                    decode_filename(raw_name)
                };
                refs.push((name, None));
            }
        }

        Ok(refs)
    }

    /// List sheets as lightweight `PageMeta` derived from filenames only (no
    /// reads/decrypts). Only `name` (canonical) and `journal_date` are real;
    /// title/counts/timestamps are placeholders. Used to resolve which pages
    /// exist (and their hashes) without decrypting every file.
    pub async fn list_sheet_names(
        &self,
        content_type: &ContentType,
    ) -> Result<Vec<PageMeta>, StorageError> {
        Ok(self
            .collect_sheet_refs(content_type)
            .await?
            .into_iter()
            .map(|(name, date)| crate::fs::sheet_ref_meta(content_type, &name, date))
            .collect())
    }

    async fn collect_sheets(&self, content_type: &ContentType) -> Result<Vec<Page>, StorageError> {
        let refs = self.collect_sheet_refs(content_type).await?;
        let mut pages = Vec::with_capacity(refs.len());
        for (name, date) in refs {
            match self.read_sheet(content_type, &name, date).await {
                Ok(page) => pages.push(page),
                Err(e) => {
                    debug!("Failed to read encrypted sheet {}/{}: {}", content_type.id, name, e);
                }
            }
        }
        Ok(pages)
    }

    /// Read and decrypt a sheet (one code path, driven by `organization`).
    pub async fn read_sheet(&self, content_type: &ContentType, name: &str, date: Option<NaiveDate>) -> Result<Page, StorageError> {
        validate_safe_name(name)?;
        // The directory is interpolated into the on-disk path via sheet_path, and
        // for page/journal it comes from user-editable config, so always validate
        // it (defends against `directory = "../.."` traversal).
        validate_safe_name(&content_type.directory)?;

        // For date-named types (journals) the name IS the date.
        let resolved_date = if content_type.is_date_named() {
            Some(
                NaiveDate::parse_from_str(name, "%Y-%m-%d")
                    .map_err(|_| StorageError::NotFound(format!("Invalid date: {}", name)))?,
            )
        } else {
            date
        };

        let path = self.sheet_path(content_type, name, resolved_date);

        // Backwards compat: try encoded path first, fall back to raw path.
        let path = if path.exists() {
            path
        } else {
            let raw_path = self.raw_sheet_path(content_type, name, resolved_date);
            if raw_path.exists() {
                raw_path
            } else if content_type.id == "journal" {
                // Journal-only: a missing date is an empty journal, not an error.
                return Ok(Page::new_journal(
                    resolved_date.expect("date-named type resolves a date"),
                ));
            } else {
                return Err(StorageError::NotFound(format!("{}/{}", content_type.id, name)));
            }
        };

        let encrypted = tokio::fs::read(&path).await?;
        let content = self.decrypt_file(&encrypted)?;

        let mut page = parse_markdown(&content, name)
            .map_err(|e| StorageError::ParseError(e.to_string()))?;

        // Canonical page name via the shared name authority (bare for
        // page/journal, directory-prefixed otherwise).
        page.name = tend_core::qualify_name(content_type, name, resolved_date);

        // Set content type
        page.content_type = content_type.id.clone();

        // Associate a date for date-foldered types (used for building URLs).
        if content_type.is_date_foldered() {
            page.journal_date = resolved_date;
        }

        // Journal-specific fields (the isolated journal layer).
        if content_type.id == "journal" {
            let d = resolved_date.expect("journal resolves a date");
            page.is_journal = true;
            page.journal_date = Some(d);
            page.title = d.format("%A, %B %-d, %Y").to_string();
        }

        let metadata = tokio::fs::metadata(&path).await?;
        if let Ok(modified) = metadata.modified() {
            page.modified_at = modified.into();
        }
        if let Ok(created) = metadata.created() {
            page.created_at = created.into();
        }

        Ok(page)
    }

    /// Encrypt and write a sheet.
    pub async fn write_sheet(&self, content_type: &ContentType, page: &Page, date: Option<NaiveDate>) -> Result<(), StorageError> {
        // Journal: the filename is its date (the isolated journal layer).
        if content_type.id == "journal" {
            validate_safe_name(&content_type.directory)?;
            let d = page
                .journal_date
                .unwrap_or_else(|| chrono::Local::now().date_naive());
            let date_name = d.format("%Y-%m-%d").to_string();
            // Route through sheet_path so journal writes honor content_type.directory,
            // matching reads (no read/write directory asymmetry).
            let path = self.sheet_path(content_type, &date_name, Some(d));
            return self.write_file(&path, page).await;
        }

        // Decompose the canonical page.name to the bare sheet name via the
        // shared name authority.
        let (sheet_name, _) = tend_core::split_name(content_type, &page.name);

        validate_safe_name(sheet_name)?;
        validate_safe_name(&content_type.directory)?;
        self.ensure_content_type_dir(content_type, date).await?;
        let path = self.sheet_path(content_type, sheet_name, date);
        self.write_file(&path, page).await
    }

    /// Delete an encrypted sheet.
    pub async fn delete_sheet(&self, content_type: &ContentType, name: &str, date: Option<NaiveDate>) -> Result<(), StorageError> {
        // Journal: the name IS the date (the isolated journal layer).
        let path = if content_type.id == "journal" {
            validate_safe_name(&content_type.directory)?;
            let journal_date = NaiveDate::parse_from_str(name, "%Y-%m-%d")
                .map_err(|_| StorageError::NotFound(format!("Invalid journal date: {}", name)))?;
            let date_name = journal_date.format("%Y-%m-%d").to_string();
            let path = self.sheet_path(content_type, &date_name, None);
            if !path.exists() {
                return Err(StorageError::NotFound(format!("Journal not found: {}", name)));
            }
            path
        } else {
            validate_safe_name(name)?;
            validate_safe_name(&content_type.directory)?;
            let path = self.sheet_path(content_type, name, date);

            // Backwards compat: try encoded path first, fall back to raw path
            if path.exists() {
                path
            } else {
                let raw_path = self.raw_sheet_path(content_type, name, date);
                if raw_path.exists() {
                    raw_path
                } else {
                    return Err(StorageError::NotFound(format!("{}/{}", content_type.id, name)));
                }
            }
        };

        let _guard = self.write_lock.read().await;

        {
            let mut pending = self.pending_writes.write().await;
            pending.insert(path.clone());
        }

        tokio::fs::remove_file(&path).await?;

        info!("Deleted encrypted sheet: {}/{}", content_type.id, name);

        Ok(())
    }

    /// Check if an encrypted sheet exists.
    pub async fn sheet_exists(&self, content_type: &ContentType, name: &str, date: Option<NaiveDate>) -> bool {
        if validate_safe_name(name).is_err() {
            return false;
        }
        if validate_safe_name(&content_type.directory).is_err() {
            return false;
        }
        self.sheet_path(content_type, name, date).exists()
            || self.raw_sheet_path(content_type, name, date).exists()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encryption::encrypt;
    use tempfile::TempDir;

    async fn setup() -> (TempDir, EncryptedFileManager) {
        let temp_dir = TempDir::new().unwrap();
        let passphrase = "test-passphrase";

        // Create verification file
        let verify_path = temp_dir.path().join(".tend").join("encryption.verify");
        std::fs::create_dir_all(verify_path.parent().unwrap()).unwrap();
        let verify_content = encrypt("tend-encryption-verification", passphrase).unwrap();
        std::fs::write(&verify_path, verify_content).unwrap();

        let efm = EncryptedFileManager::new(temp_dir.path(), passphrase.to_string()).unwrap();
        (temp_dir, efm)
    }

    #[tokio::test]
    async fn list_sheet_names_lists_by_filename_without_decrypting() {
        let (temp, efm) = setup().await;

        // A file that is NOT valid ciphertext: reading/decrypting it would fail.
        std::fs::create_dir_all(temp.path().join("pages")).unwrap();
        std::fs::write(temp.path().join("pages").join("Junk.md.age"), b"not-real-ciphertext").unwrap();

        // Names come from the filename only — no decrypt — so it IS listed.
        let names = efm.list_sheet_names(&ContentType::page()).await.unwrap();
        assert!(
            names.iter().any(|m| m.name == "Junk"),
            "list_sheet_names should list by filename without reading"
        );

        // list_sheets actually decrypts, so it can't read the garbage and skips it.
        let full = efm.list_sheets(&ContentType::page()).await.unwrap();
        assert!(
            !full.iter().any(|m| m.name == "Junk"),
            "list_sheets reads/decrypts, so the unreadable file is excluded"
        );
    }

    #[tokio::test]
    async fn test_verify_passphrase() {
        let (temp_dir, _efm) = setup().await;

        assert!(EncryptedFileManager::verify_passphrase(temp_dir.path(), "test-passphrase").unwrap());
        assert!(!EncryptedFileManager::verify_passphrase(temp_dir.path(), "wrong-passphrase").unwrap());
    }

    #[tokio::test]
    async fn test_migrates_legacy_scrypt_file_to_identity() {
        let temp = TempDir::new().unwrap();
        let passphrase = "test-passphrase";

        // Legacy garden: a verify file plus a page encrypted *directly* with the
        // passphrase (the old scrypt-per-file format), and no identity yet.
        let vp = temp.path().join(".tend").join("encryption.verify");
        std::fs::create_dir_all(vp.parent().unwrap()).unwrap();
        std::fs::write(&vp, encrypt("tend-encryption-verification", passphrase).unwrap()).unwrap();

        std::fs::create_dir_all(temp.path().join("pages")).unwrap();
        let mut page = Page::new("Legacy Page");
        page.add_block(tend_core::Block::new("legacy secret"));
        let fname = format!("{}.{}", encode_filename("Legacy Page"), ENCRYPTED_EXT);
        let legacy_path = temp.path().join("pages").join(fname);
        std::fs::write(&legacy_path, encrypt(&serialize_page(&page), passphrase).unwrap()).unwrap();

        // Constructing mints an identity; migration re-encrypts the legacy file.
        let efm = EncryptedFileManager::new(temp.path(), passphrase.to_string()).unwrap();
        assert_eq!(efm.migrate_to_identity().await.unwrap(), 1);
        assert_eq!(efm.migrate_to_identity().await.unwrap(), 0, "idempotent");

        // Content is preserved and the file is now X25519 (identity-decryptable).
        let read = efm.read_page("Legacy Page").await.unwrap();
        assert_eq!(read.blocks.len(), 1);
        let data = std::fs::read(&legacy_path).unwrap();
        assert!(decrypt_with_identity(&data, &efm.identity).is_ok());
        // ...and no longer the passphrase-scrypt format.
        assert!(decrypt(&data, passphrase).is_err());
    }

    #[tokio::test]
    async fn test_encrypted_write_and_read_page() {
        let (_temp_dir, efm) = setup().await;

        let mut page = Page::new("Secret Page");
        let block = tend_core::Block::new("Top secret content!");
        page.add_block(block);

        efm.write_page(&page).await.unwrap();

        let read_page = efm.read_page("Secret Page").await.unwrap();
        assert_eq!(read_page.name, "Secret Page");
        assert_eq!(read_page.blocks.len(), 1);
    }

    #[tokio::test]
    async fn test_encrypted_journal() {
        let (_temp_dir, efm) = setup().await;

        let date = NaiveDate::from_ymd_opt(2025, 1, 20).unwrap();
        let mut page = Page::new_journal(date);
        let block = tend_core::Block::new("Encrypted journal entry");
        page.add_block(block);

        efm.write_page(&page).await.unwrap();

        let read_page = efm.read_journal(date).await.unwrap();
        assert!(read_page.is_journal);
        assert_eq!(read_page.journal_date, Some(date));
    }

    #[tokio::test]
    async fn test_list_encrypted_pages() {
        let (_temp_dir, efm) = setup().await;

        for name in ["Page A", "Page B", "Page C"] {
            let mut page = Page::new(name);
            page.add_block(tend_core::Block::new("Content"));
            efm.write_page(&page).await.unwrap();
        }

        let pages = efm.list_pages().await.unwrap();
        assert_eq!(pages.len(), 3);
    }
}
