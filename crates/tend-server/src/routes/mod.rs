// SPDX-License-Identifier: MIT WITH Commons-Clause
//! API routes

use std::sync::Arc;

use axum::extract::DefaultBodyLimit;
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use serde::Serialize;

use crate::auth::AuthenticatedUser;
use crate::state::AppState;

mod pages;
mod journals;
mod search;
mod links;
mod blocks;
mod git;
mod graph;
mod gardens;
mod sheets;
mod tags;
mod templates;
mod todos;
mod import;
mod user;
mod reindex;

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
        .route("/search/status", get(search::status))
        .route("/search/rebuild", post(search::rebuild))
        // Links
        .route("/links/status", get(links::status))
        .route("/links/rebuild", post(links::rebuild))
        .route("/links/wikilink-targets", get(links::wikilink_targets))
        // Blocks (status/rebuild must come before {uuid} wildcard)
        .route("/blocks/status", get(blocks::status))
        .route("/blocks/rebuild", post(blocks::rebuild))
        .route("/blocks/{uuid}", get(blocks::get_block))
        // Reindex (rebuild all indices at once)
        .route("/reindex", post(reindex::reindex))
        // Stabilize (add Tend footers to files missing them, then reindex)
        .route("/stabilize", post(reindex::stabilize))
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
        .route("/git/remote", post(git::set_remote))
        .route("/git/remote", delete(git::remove_remote))
        .route("/git/remote/test", post(git::test_remote))
        .route("/git/remote/check-garden", get(git::check_remote_garden))
        .route("/git/remote/import", post(git::import_remote_garden))
        // Gardens
        .route("/gardens", get(gardens::list_gardens))
        .route("/gardens", post(gardens::create_garden))
        .route("/gardens/{id}", delete(gardens::delete_garden))
        .route("/gardens/{id}/restore", post(gardens::restore_garden))
        .route("/gardens/{id}/permanent", delete(gardens::delete_archived_garden))
        .route("/gardens/switch", post(gardens::switch_garden))
        .route("/gardens/unlock", post(gardens::unlock_garden))
        .route("/gardens/rename", post(gardens::rename_garden))
        // Content Types
        .route("/content-types", get(gardens::get_content_types))
        .route("/content-types", put(gardens::update_content_types))
        // Sheets (generic content type API)
        .route("/sheets/{content_type}", get(sheets::list_sheets))
        .route("/sheets/{content_type}", post(sheets::create_sheet))
        .route("/sheets/{content_type}/{name}", get(sheets::get_sheet))
        .route("/sheets/{content_type}/{name}", put(sheets::update_sheet))
        .route("/sheets/{content_type}/{name}", delete(sheets::delete_sheet))
        // Templates (content type template files)
        .route("/templates/{content_type_id}", get(templates::get_template))
        .route("/templates/{content_type_id}", put(templates::update_template))
        .route("/templates/{content_type_id}", delete(templates::delete_template))
        // Import (new zip-based API) - upload route needs larger body limit
        .route(
            "/import/logseq/upload",
            post(import::import_logseq_zip).layer(DefaultBodyLimit::max(import::MAX_UPLOAD_SIZE)),
        )
        .route("/import/errors", get(import::list_import_errors))
        .route("/import/errors", delete(import::delete_all_import_errors))
        .route("/import/errors/{name}", get(import::get_import_error))
        .route("/import/errors/{name}", delete(import::delete_import_error))
        .route("/import/errors/{name}/accept", post(import::accept_import_error))
        // Import (legacy path-based API - for backward compatibility)
        .route("/import/logseq", post(import::import_logseq))
        // Identity
        .route("/whoami", get(whoami))
        // User preferences and state (multi-tenant)
        .route("/user/prefs", get(user::get_prefs))
        .route("/user/prefs", put(user::put_prefs))
        .route("/user/state", get(user::get_state))
        .route("/user/state", put(user::put_state))
        // Health check
        .route("/health", get(health))
}

/// Response for whoami endpoint
#[derive(Serialize)]
struct WhoamiResponse {
    username: String,
}

/// Returns the currently authenticated user
async fn whoami(user: AuthenticatedUser) -> Json<WhoamiResponse> {
    Json(WhoamiResponse {
        username: user.username,
    })
}

async fn health() -> &'static str {
    "OK"
}
