// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Error types for tend-core

use thiserror::Error;

#[derive(Error, Debug)]
pub enum CoreError {
    #[error("Failed to parse markdown: {0}")]
    ParseError(String),

    #[error("Invalid block UUID: {0}")]
    InvalidUuid(String),

    /// Optimistic-concurrency failure: the page changed under the client.
    /// The message text is the one the HTTP 409 body has always carried.
    #[error("Version mismatch: expected {expected}, current {current}")]
    VersionConflict { expected: u64, current: u64 },

    #[error("Block not found: {0}")]
    BlockNotFound(String),

    #[error("Page not found: {0}")]
    PageNotFound(String),

    #[error("Invalid date format: {0}")]
    InvalidDate(String),

    #[error("Serialization error: {0}")]
    SerializationError(String),
}
