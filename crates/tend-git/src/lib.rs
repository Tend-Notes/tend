// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Tend Git - Git backup operations
//!
//! This crate handles scheduled Git backups with garden locking.
//! Uses gitoxide (gix) for pure-Rust Git operations.

pub mod error;
pub mod backup;

pub use error::GitError;
pub use backup::{BackupManager, BackupResult, GitStatus};
