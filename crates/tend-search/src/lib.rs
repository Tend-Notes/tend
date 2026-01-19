// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Tend Search - Full-text search using Tantivy
//!
//! This crate provides search functionality for the Tend digital garden.
//! It uses Tantivy for fast, fuzzy full-text search.

pub mod error;
pub mod index;
pub mod schema;

pub use error::SearchError;
pub use index::{SearchIndex, SearchResult};
