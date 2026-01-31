// SPDX-License-Identifier: MIT WITH Commons-Clause
//! TODO aggregation API routes

use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use regex::Regex;
use serde::Serialize;

use crate::auth::AuthenticatedUser;
use crate::error::AppError;
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
    /// Whether the page is a journal
    pub is_journal: bool,
    /// Journal date if applicable
    pub journal_date: Option<String>,
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

    // Scan all pages
    let pages = garden.file_manager.list_pages().await?;
    for page_meta in &pages {
        if let Ok(page) = garden.file_manager.read_page(&page_meta.name).await {
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
                        is_journal: false,
                        journal_date: None,
                    });
                }
            }
        }
    }

    // Scan all journals
    let journals = garden.file_manager.list_journals().await?;
    for journal_meta in &journals {
        if let Some(date) = journal_meta.journal_date {
            if let Ok(page) = garden.file_manager.read_journal(date).await {
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
                            is_journal: true,
                            journal_date: Some(date.to_string()),
                        });
                    }
                }
            }
        }
    }

    Ok(Json(TaskList { tasks }))
}
