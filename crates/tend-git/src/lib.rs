// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Tend Git - Git backup operations
//!
//! This crate handles scheduled Git backups with garden locking.
//! Provides commit history browsing and diff viewing.

pub mod backup;
pub mod error;

pub use backup::{
    BackupManager, BackupResult, ChangedFile, CommitDiff, CommitInfo, FileDiff, FileStatus,
    GitStatus, ImportResult, PushResult, RemoteGardenInfo, RemoteResult,
};
pub use error::GitError;
