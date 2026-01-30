// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Error types for tend-storage

use thiserror::Error;

#[derive(Error, Debug)]
pub enum StorageError {
    #[error("IO error: {0}")]
    Io(std::io::Error),

    #[error("File not found: {0}")]
    NotFound(String),

    #[error("Invalid path: {0}")]
    InvalidPath(String),

    #[error("Parse error: {0}")]
    ParseError(String),

    #[error("Lock error: {0}")]
    LockError(String),

    #[error("Watch error: {0}")]
    WatchError(String),

    #[error("Encryption error: {0}")]
    Encryption(String),

    #[error("{0}")]
    Other(String),
}

impl From<std::io::Error> for StorageError {
    fn from(e: std::io::Error) -> Self {
        if e.kind() == std::io::ErrorKind::NotFound {
            // Extract path from error message if available, otherwise use generic message
            StorageError::NotFound(e.to_string())
        } else {
            StorageError::Io(e)
        }
    }
}
