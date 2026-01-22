// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Tend Core - Domain logic for the Tend digital garden
//!
//! This crate contains:
//! - Block and Page data models
//! - Logseq-compatible Markdown parser
//! - Markdown serializer

pub mod block;
pub mod content_type;
pub mod page;
pub mod parser;
pub mod serializer;
pub mod error;

pub use block::Block;
pub use content_type::ContentType;
pub use page::{Page, PageMeta};
pub use error::CoreError;
