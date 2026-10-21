// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Tend Storage - File system operations for the Tend digital garden
//!
//! This crate handles:
//! - Reading and writing Markdown files
//! - Atomic file operations
//! - File watching for external changes
//! - Optional age encryption for encrypted gardens
//!
//! # Features
//!
//! `fs` (default) pulls in the filesystem layer: `FileManager`,
//! `EncryptedFileManager` and the watcher, all of which need tokio and notify.
//! With it off, what remains is the platform-independent core — age encryption
//! and filename encoding — which is what the wasm bridge compiles against so
//! the browser writes byte-identical files. See `crates/tend-wasm`.

pub mod encryption;
pub mod error;
pub mod names;

#[cfg(feature = "fs")]
pub mod encrypted_fs;
#[cfg(feature = "fs")]
pub mod fs;
#[cfg(feature = "fs")]
pub mod watcher;

pub use encryption::{decrypt, encrypt, is_age_encrypted, EncryptionError};
pub use error::StorageError;
pub use names::{decode_filename, encode_filename, validate_safe_name};

#[cfg(feature = "fs")]
pub use encrypted_fs::EncryptedFileManager;
#[cfg(feature = "fs")]
pub use fs::FileManager;
#[cfg(feature = "fs")]
pub use watcher::{FileEvent, FileWatcher, SimpleFileWatcher};
