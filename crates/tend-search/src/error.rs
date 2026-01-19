// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Error types for tend-search

use thiserror::Error;

#[derive(Error, Debug)]
pub enum SearchError {
    #[error("Index error: {0}")]
    IndexError(String),

    #[error("Query error: {0}")]
    QueryError(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

impl From<tantivy::TantivyError> for SearchError {
    fn from(e: tantivy::TantivyError) -> Self {
        SearchError::IndexError(e.to_string())
    }
}

impl From<tantivy::query::QueryParserError> for SearchError {
    fn from(e: tantivy::query::QueryParserError) -> Self {
        SearchError::QueryError(e.to_string())
    }
}
