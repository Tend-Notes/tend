// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Search schema definition

use tantivy::schema::{Schema, STORED, STRING, TEXT};

/// Create the Tantivy schema for indexing blocks
pub fn create_schema() -> Schema {
    let mut schema_builder = Schema::builder();

    // Block UUID - stored for retrieval
    schema_builder.add_text_field("uuid", STRING | STORED);

    // Block content - full-text searchable and stored
    schema_builder.add_text_field("content", TEXT | STORED);

    // Page name - stored for context
    schema_builder.add_text_field("page_name", STRING | STORED);

    // Page title - stored for display
    schema_builder.add_text_field("page_title", TEXT | STORED);

    // Is journal - stored as string "true"/"false"
    schema_builder.add_text_field("is_journal", STRING | STORED);

    schema_builder.build()
}
