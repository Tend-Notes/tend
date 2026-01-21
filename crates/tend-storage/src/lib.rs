// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Tend Storage - File system operations for the Tend digital garden
//!
//! This crate handles:
//! - Reading and writing Markdown files
//! - Atomic file operations
//! - File watching for external changes
//! - Optional age encryption for encrypted gardens

pub mod encryption;
pub mod encrypted_fs;
pub mod error;
pub mod fs;
pub mod watcher;

pub use encrypted_fs::EncryptedFileManager;
pub use encryption::{decrypt, encrypt, is_age_encrypted, EncryptionError};
pub use error::StorageError;
pub use fs::FileManager;
pub use watcher::{FileEvent, FileWatcher, SimpleFileWatcher};
