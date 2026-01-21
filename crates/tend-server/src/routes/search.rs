// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Search API routes

use std::sync::Arc;

use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
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

/// Search response that includes status information
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub results: Vec<SearchResult>,
    /// Search status for encrypted gardens
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<SearchStatus>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchStatus {
    /// Whether search is disabled for this garden
    pub disabled: bool,
    /// Whether the index is currently being rebuilt
    pub rebuilding: bool,
    /// Message to display to user
    pub message: Option<String>,
}

/// Search for blocks
pub async fn search(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<SearchResponse>, AppError> {
    if query.q.trim().is_empty() {
        return Ok(Json(SearchResponse {
            results: Vec::new(),
            status: None,
        }));
    }

    let garden = state.garden.read().await;

    // Check if search is disabled
    if !garden.search_config.enabled {
        return Ok(Json(SearchResponse {
            results: Vec::new(),
            status: Some(SearchStatus {
                disabled: true,
                rebuilding: false,
                message: Some("Search is disabled for this encrypted garden".to_string()),
            }),
        }));
    }

    // Check if we have a search index
    let search_index = match &garden.search_index {
        Some(index) => index,
        None => {
            // Search is enabled but index doesn't exist (was deleted by TTL or never built)
            return Ok(Json(SearchResponse {
                results: Vec::new(),
                status: Some(SearchStatus {
                    disabled: false,
                    rebuilding: false,
                    message: Some("Search index needs to be rebuilt. This may take a moment.".to_string()),
                }),
            }));
        }
    };

    // Update last use time for TTL tracking
    garden.touch_search_index().await;

    let index = search_index.read().await;
    let results = index.search(&query.q, query.limit)?;

    Ok(Json(SearchResponse {
        results,
        status: None,
    }))
}
