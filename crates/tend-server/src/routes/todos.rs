// SPDX-License-Identifier: MIT WITH Commons-Clause
//! TODO aggregation API routes

use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use regex::Regex;
use serde::Serialize;

use crate::auth::AuthenticatedUser;
use crate::error::AppError;
use crate::routes::gardens::load_user_content_types;
use crate::state::AppState;

/// A task item found in a block
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskItem {
    /// The block UUID
    pub uuid: String,
    /// The task status keyword (TODO, DOING, DONE, etc.)
    pub status: String,
    /// The block content (after the status keyword)
    pub content: String,
    /// The page name where this task is located
    pub page_name: String,
    /// The page title
    pub page_title: String,

    /// Content type ID (e.g., "page", "journal", "meetings")
    pub content_type: String,
    /// Whether the page is a journal
    pub is_journal: bool,
    /// Journal date if applicable
    pub journal_date: Option<String>,
    /// Due date (YYYY-MM-DD format)
    pub due_date: Option<String>,
    /// Start date (YYYY-MM-DD format)
    pub start_date: Option<String>,
    /// Priority level (1, 2, or 3)
    pub priority: Option<String>,
}

/// List of all tasks across the garden
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskList {
    pub tasks: Vec<TaskItem>,
}

/// Get all tasks across all pages and journals
pub async fn list_todos(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<Json<TaskList>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;

    // Task status keywords to look for
    // Match keyword at start, optionally followed by whitespace and content
    let status_pattern = Regex::new(r"^(TODO|DOING|DONE|NOW|LATER|NEVER)(?:\s+(.*))?$")
        .expect("Invalid regex");

    let mut tasks = Vec::new();

    // Get all content types for this garden (pages, journals, custom sheets)
    let content_types = load_user_content_types(&user.username).unwrap_or_default();

    // Scan all content types
    for ct in &content_types {
        let sheets = garden.file_manager.list_sheets(ct).await?;
        for sheet_meta in &sheets {
            // Read the full page for this sheet
            let page = if ct.id == "journal" {
                if let Some(date) = sheet_meta.journal_date {
                    garden.file_manager.read_journal(date).await.ok()
                } else {
                    None
                }
            } else if ct.id == "page" {
                garden.file_manager.read_page(&sheet_meta.name).await.ok()
            } else {
                garden.file_manager.read_sheet(ct, &sheet_meta.name, sheet_meta.journal_date).await.ok()
            };

            if let Some(page) = page {
                for block in page.blocks.values() {
                    if let Some(captures) = status_pattern.captures(&block.content) {
                        let status = captures.get(1).unwrap().as_str().to_string();
                        let content = captures.get(2).map(|m| m.as_str()).unwrap_or("").to_string();

                        tasks.push(TaskItem {
                            uuid: block.uuid.to_string(),
                            status,
                            content,
                            page_name: page.name.clone(),
                            page_title: page.title.clone(),
                            content_type: ct.id.clone(),
                            is_journal: ct.id == "journal",
                            journal_date: sheet_meta.journal_date.map(|d| d.to_string()),
                            due_date: block.properties.get("due_date").cloned(),
                            start_date: block.properties.get("start_date").cloned(),
                            priority: block.properties.get("priority").cloned(),
                        });
                    }
                }
            }
        }
    }

    Ok(Json(TaskList { tasks }))
}
