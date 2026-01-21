// SPDX-License-Identifier: MIT WITH Commons-Clause
//! API routes

use std::sync::Arc;

use axum::routing::{delete, get, post, put};
use axum::Router;

use crate::state::AppState;

mod pages;
mod journals;
mod search;
mod git;
mod graph;
mod gardens;
mod tags;
mod todos;

/// Build the API router
pub fn api_router() -> Router<Arc<AppState>> {
    Router::new()
        // Pages
        .route("/pages", get(pages::list_pages))
        .route("/pages", post(pages::create_page))
        .route("/pages/{name}", get(pages::get_page))
        .route("/pages/{name}", put(pages::update_page))
        .route("/pages/{name}", delete(pages::delete_page))
        .route("/pages/{name}/backlinks", get(pages::get_backlinks))
        // Journals
        .route("/journals", get(journals::list_journals))
        .route("/journals/today", get(journals::get_today))
        .route("/journals/{date}", get(journals::get_journal))
        .route("/journals/{date}", put(journals::update_journal))
        // Search
        .route("/search", get(search::search))
        // Tags
        .route("/tags", get(tags::list_tags))
        // Todos
        .route("/todos", get(todos::list_todos))
        // Graph
        .route("/graph", get(graph::get_graph))
        // Git
        .route("/git/status", get(git::status))
        .route("/git/backup", post(git::backup))
        .route("/git/commit", post(git::commit))
        .route("/git/history", get(git::history))
        .route("/git/diff/{commit}", get(git::diff))
        .route("/git/restore", post(git::restore))
        .route("/git/push", post(git::push))
        .route("/git/pull", post(git::pull))
        // Gardens
        .route("/gardens", get(gardens::list_gardens))
        .route("/gardens", post(gardens::create_garden))
        .route("/gardens/{id}", delete(gardens::delete_garden))
        .route("/gardens/{id}/restore", post(gardens::restore_garden))
        .route("/gardens/{id}/permanent", delete(gardens::delete_archived_garden))
        .route("/gardens/switch", post(gardens::switch_garden))
        // Health check
        .route("/health", get(health))
}

async fn health() -> &'static str {
    "OK"
}
