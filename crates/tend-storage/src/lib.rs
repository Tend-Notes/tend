// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Tend Storage - File system operations for the Tend digital garden
//!
//! This crate handles:
//! - Reading and writing Markdown files
//! - Atomic file operations
//! - File watching for external changes

pub mod error;
pub mod fs;
pub mod watcher;

pub use error::StorageError;
pub use fs::FileManager;
pub use watcher::{FileEvent, FileWatcher, SimpleFileWatcher};
