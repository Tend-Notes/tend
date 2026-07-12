// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Graph API routes

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use serde::Serialize;

use crate::auth::AuthenticatedUser;
use crate::error::AppError;
use crate::routes::gardens::load_user_content_types;
use crate::state::AppState;

/// A node in the knowledge graph
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    /// Content type ID (e.g., "page", "journal", "meetings")
    pub content_type: String,
    pub block_count: usize,
}

/// An edge in the knowledge graph
#[derive(Debug, Serialize)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    pub weight: usize,
}

/// Content type info for the graph legend
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphContentType {
    pub id: String,
    pub name: String,
}

/// The full knowledge graph
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Graph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    /// Content types present in the graph (for legend)
    pub content_types: Vec<GraphContentType>,
}

/// Get the full knowledge graph
pub async fn get_graph(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<Json<Graph>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;

    let mut nodes = Vec::new();
    let mut edges_map: HashMap<(String, String), usize> = HashMap::new();
    let mut existing_pages: HashSet<String> = HashSet::new();
    let mut content_types_used: HashSet<String> = HashSet::new();

    // Get all content types for this garden
    let content_types = load_user_content_types(&user.username).unwrap_or_default();

    // Nodes: one metadata pass over each content type (title + block_count).
    for ct in &content_types {
        let sheets = garden.file_manager.list_sheets(ct).await?;
        for sheet_meta in &sheets {
            existing_pages.insert(sheet_meta.name.clone());
            content_types_used.insert(ct.id.clone());
            nodes.push(GraphNode {
                id: sheet_meta.name.clone(),
                label: sheet_meta.title.clone(),
                content_type: ct.id.clone(),
                block_count: sheet_meta.block_count,
            });
        }
    }

    // Edges: derive from the link index rather than re-reading and re-parsing
    // every page body. The index knows every wiki-link as (source_hash,
    // target_name); map source_hash back to a page name via the nodes.
    {
        let mut hash_to_name: HashMap<String, String> = HashMap::with_capacity(nodes.len());
        for node in &nodes {
            hash_to_name.insert(tend_links::hash_page_name(&node.id), node.id.clone());
        }
        let link_index = garden.link_index.read().await;
        for (source_hash, target_name) in link_index.wiki_link_edges() {
            if let Some(source) = hash_to_name.get(&source_hash) {
                // Only create an edge if the target page exists.
                if existing_pages.contains(&target_name) {
                    *edges_map.entry((source.clone(), target_name)).or_insert(0) += 1;
                }
            }
        }
    }

    // Convert edges map to vec
    let edges: Vec<GraphEdge> = edges_map
        .into_iter()
        .map(|((source, target), weight)| GraphEdge {
            source,
            target,
            weight,
        })
        .collect();

    // Build content types list for legend (only those actually used)
    let graph_content_types: Vec<GraphContentType> = content_types
        .into_iter()
        .filter(|ct| content_types_used.contains(&ct.id))
        .map(|ct| GraphContentType {
            id: ct.id,
            name: ct.name,
        })
        .collect();

    Ok(Json(Graph {
        nodes,
        edges,
        content_types: graph_content_types,
    }))
}
