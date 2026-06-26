// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Tend Core - Domain logic for the Tend digital garden
//!
//! This crate contains:
//! - Block and Page data models
//! - Markdown parser with embedded block metadata support
//! - Markdown serializer

pub mod block;
pub mod block_metadata;
pub mod content_type;
pub mod error;
pub mod name;
pub mod page;
pub mod parser;
pub mod serializer;

pub use block::Block;
pub use block_metadata::{BlockMetadata, ParsedContent};
pub use content_type::{ContentType, Organization};
pub use error::CoreError;
pub use name::{parse as parse_name, qualify as qualify_name, split as split_name, ParsedName};
pub use page::{Page, PageMeta};
