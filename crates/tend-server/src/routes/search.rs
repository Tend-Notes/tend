// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Search API routes

use std::sync::Arc;

use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use tend_search::SearchResult;

use crate::auth::AuthenticatedUser;
use crate::error::AppError;
use crate::routes::gardens::load_user_content_types;
use crate::state::{AppState, IndexStatus};

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
    /// Search status
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<SearchStatusResponse>,
}

/// Full search status response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchStatusResponse {
    /// Current index status
    pub index_status: IndexStatus,
    /// Number of documents in the index (if ready)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_docs: Option<u64>,
    /// Whether this is an encrypted garden
    pub encrypted: bool,
    /// Message to display to user
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Get search index status
pub async fn status(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<Json<SearchStatusResponse>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;
    let index_status = garden.get_index_status().await;

    let num_docs = if let Some(ref index) = garden.search_index {
        Some(index.read().await.num_docs())
    } else {
        None
    };

    let message = match index_status {
        IndexStatus::Disabled => Some("Search is disabled for this garden".to_string()),
        IndexStatus::Ready => None,
        IndexStatus::Building => Some("Search index is being built...".to_string()),
        IndexStatus::NotBuilt => Some("Search index needs to be built".to_string()),
        IndexStatus::Expired => Some("Search index expired and was deleted".to_string()),
    };

    Ok(Json(SearchStatusResponse {
        index_status,
        num_docs,
        encrypted: garden.encrypted,
        message,
    }))
}

/// Trigger index rebuild
pub async fn rebuild(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<Json<SearchStatusResponse>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;

    // Get current status first
    let current_status = {
        let garden = user_state.garden.read().await;
        garden.get_index_status().await
    };

    // Don't rebuild if already building or disabled
    if current_status == IndexStatus::Building {
        return Ok(Json(SearchStatusResponse {
            index_status: IndexStatus::Building,
            num_docs: None,
            encrypted: user_state.garden.read().await.encrypted,
            message: Some("Index build already in progress".to_string()),
        }));
    }

    if current_status == IndexStatus::Disabled {
        return Ok(Json(SearchStatusResponse {
            index_status: IndexStatus::Disabled,
            num_docs: None,
            encrypted: user_state.garden.read().await.encrypted,
            message: Some("Search is disabled for this garden".to_string()),
        }));
    }

    // Rebuild the index - use in-place rebuild if a writer already exists,
    // otherwise create a new index from scratch
    let content_types = load_user_content_types(&user.username).unwrap_or_default();
    {
        let garden = user_state.garden.read().await;
        if garden.search_index.is_some() {
            garden.rebuild_search_index(&content_types).await.map_err(|e| {
                AppError::Internal(format!("Failed to rebuild index: {}", e))
            })?;
        } else {
            drop(garden);
            let mut garden = user_state.garden.write().await;
            garden.build_index(&content_types).await.map_err(|e| {
                AppError::Internal(format!("Failed to build index: {}", e))
            })?;
        }
    }

    // Return updated status
    let garden = user_state.garden.read().await;
    let num_docs = if let Some(ref index) = garden.search_index {
        Some(index.read().await.num_docs())
    } else {
        None
    };

    Ok(Json(SearchStatusResponse {
        index_status: IndexStatus::Ready,
        num_docs,
        encrypted: garden.encrypted,
        message: Some("Index built successfully".to_string()),
    }))
}

/// Search for blocks
pub async fn search(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Query(query): Query<SearchQuery>,
) -> Result<Json<SearchResponse>, AppError> {
    if query.q.trim().is_empty() {
        return Ok(Json(SearchResponse {
            results: Vec::new(),
            status: None,
        }));
    }

    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;
    let index_status = garden.get_index_status().await;

    // Check index status
    match index_status {
        IndexStatus::Disabled => {
            return Ok(Json(SearchResponse {
                results: Vec::new(),
                status: Some(SearchStatusResponse {
                    index_status: IndexStatus::Disabled,
                    num_docs: None,
                    encrypted: garden.encrypted,
                    message: Some("Search is disabled for this garden".to_string()),
                }),
            }));
        }
        IndexStatus::Building => {
            return Ok(Json(SearchResponse {
                results: Vec::new(),
                status: Some(SearchStatusResponse {
                    index_status: IndexStatus::Building,
                    num_docs: None,
                    encrypted: garden.encrypted,
                    message: Some("Search index is being built...".to_string()),
                }),
            }));
        }
        IndexStatus::NotBuilt | IndexStatus::Expired => {
            return Ok(Json(SearchResponse {
                results: Vec::new(),
                status: Some(SearchStatusResponse {
                    index_status,
                    num_docs: None,
                    encrypted: garden.encrypted,
                    message: Some("Search index needs to be built".to_string()),
                }),
            }));
        }
        IndexStatus::Ready => {}
    }

    // Check if we have a search index
    let search_index = match &garden.search_index {
        Some(index) => index,
        None => {
            return Ok(Json(SearchResponse {
                results: Vec::new(),
                status: Some(SearchStatusResponse {
                    index_status: IndexStatus::NotBuilt,
                    num_docs: None,
                    encrypted: garden.encrypted,
                    message: Some("Search index not available".to_string()),
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
