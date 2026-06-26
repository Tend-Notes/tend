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

    // Collect sheets from all content types
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

        // Build edges from wiki-links in this content type's sheets
        for sheet_meta in &sheets {
            let page = if ct.id == "journal" {
                // Journals use date-based reading
                if let Some(date) = sheet_meta.journal_date {
                    garden.file_manager.read_journal(date).await.ok()
                } else {
                    None
                }
            } else if ct.id == "page" {
                garden.file_manager.read_page(&sheet_meta.name).await.ok()
            } else {
                // sheet_meta.name includes the directory prefix (e.g., "meetings/StandupNotes")
                // but read_sheet expects just the bare name without the directory prefix.
                let bare_name = strip_directory_prefix(&sheet_meta.name, &ct.directory, ct.is_date_foldered());
                garden.file_manager.read_sheet(ct, bare_name, sheet_meta.journal_date).await.ok()
            };

            if let Some(page) = page {
                let links = page.all_wiki_links();
                for link in links {
                    // Only create edge if target exists
                    if existing_pages.contains(&link) {
                        let key = (sheet_meta.name.clone(), link.clone());
                        *edges_map.entry(key).or_insert(0) += 1;
                    }
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

/// Strip the directory prefix from a sheet name to get the bare name.
///
/// `list_sheets` returns PageMeta with names like "meetings/StandupNotes" or
/// "meetings/2026-01-23/StandupNotes" (for saveByDate types), but `read_sheet`
/// expects just "StandupNotes" because it reconstructs the full path internally.
fn strip_directory_prefix<'a>(name: &'a str, directory: &str, date_foldered: bool) -> &'a str {
    if let Some(without_dir) = name.strip_prefix(directory).and_then(|s| s.strip_prefix('/')) {
        if date_foldered {
            // Format: YYYY-MM-DD/name - strip the date component too
            if let Some((_date, bare)) = without_dir.split_once('/') {
                bare
            } else {
                without_dir
            }
        } else {
            without_dir
        }
    } else {
        // Name doesn't have the expected prefix; use as-is (e.g., built-in "page" type)
        name
    }
}
