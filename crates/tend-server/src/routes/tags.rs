// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Tags API routes

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use regex::Regex;
use serde::Serialize;

use crate::error::AppError;
use crate::state::AppState;

/// Tag info with usage count
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagInfo {
    pub name: String,
    pub count: usize,
}

/// List all tags used across the garden
pub async fn list_tags(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<TagInfo>>, AppError> {
    let garden = state.garden.read().await;
    let mut tag_counts: HashMap<String, usize> = HashMap::new();

    // Regex to match tags: #tagname (at start or after whitespace)
    let tag_regex = Regex::new(r"(?:^|\s)#([a-zA-Z][a-zA-Z0-9_-]*)").unwrap();

    // Scan all pages for tags
    let pages = garden.file_manager.list_pages().await?;
    for page_meta in pages {
        if let Ok(page) = garden.file_manager.read_page(&page_meta.name).await {
            for block in page.blocks.values() {
                for cap in tag_regex.captures_iter(&block.content) {
                    let tag_name = cap.get(1).unwrap().as_str().to_string();
                    *tag_counts.entry(tag_name).or_insert(0) += 1;
                }
            }
        }
    }

    // Also check journals
    let journals = garden.file_manager.list_journals().await?;
    for journal_meta in journals {
        if let Some(date) = journal_meta.journal_date {
            if let Ok(page) = garden.file_manager.read_journal(date).await {
                for block in page.blocks.values() {
                    for cap in tag_regex.captures_iter(&block.content) {
                        let tag_name = cap.get(1).unwrap().as_str().to_string();
                        *tag_counts.entry(tag_name).or_insert(0) += 1;
                    }
                }
            }
        }
    }

    // Convert to sorted list
    let mut tags: Vec<TagInfo> = tag_counts
        .into_iter()
        .map(|(name, count)| TagInfo { name, count })
        .collect();

    // Sort by name
    tags.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(Json(tags))
}
