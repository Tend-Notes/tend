// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Search API routes

use std::sync::Arc;

use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;
use tend_search::SearchResult;

use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: String,
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_limit() -> usize {
    20
}

/// Search for blocks
pub async fn search(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<Vec<SearchResult>>, AppError> {
    if query.q.trim().is_empty() {
        return Ok(Json(Vec::new()));
    }

    let index = state.search_index.read().await;
    let results = index.search(&query.q, query.limit)?;

    Ok(Json(results))
}
