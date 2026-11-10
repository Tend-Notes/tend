// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Error types for tend-core

use thiserror::Error;

#[derive(Error, Debug)]
pub enum CoreError {
    #[error("Failed to parse markdown: {0}")]
    ParseError(String),

    #[error("Invalid block UUID: {0}")]
    InvalidUuid(String),

    #[error("Block not found: {0}")]
    BlockNotFound(String),

    #[error("Page not found: {0}")]
    PageNotFound(String),

    #[error("Invalid date format: {0}")]
    InvalidDate(String),

    #[error("Serialization error: {0}")]
    SerializationError(String),
}
