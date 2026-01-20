// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Graph API routes

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use serde::Serialize;

use crate::error::AppError;
use crate::state::AppState;

/// A node in the knowledge graph
#[derive(Debug, Serialize)]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    pub is_journal: bool,
    pub block_count: usize,
}

/// An edge in the knowledge graph
#[derive(Debug, Serialize)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    pub weight: usize,
}

/// The full knowledge graph
#[derive(Debug, Serialize)]
pub struct Graph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

/// Get the full knowledge graph
pub async fn get_graph(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Graph>, AppError> {
    let garden = state.garden.read().await;

    let mut nodes = Vec::new();
    let mut edges_map: HashMap<(String, String), usize> = HashMap::new();
    let mut existing_pages: HashSet<String> = HashSet::new();

    // Collect all pages
    let pages = garden.file_manager.list_pages().await?;
    for page_meta in &pages {
        existing_pages.insert(page_meta.name.clone());
        nodes.push(GraphNode {
            id: page_meta.name.clone(),
            label: page_meta.title.clone(),
            is_journal: false,
            block_count: page_meta.block_count,
        });
    }

    // Collect all journals
    let journals = garden.file_manager.list_journals().await?;
    for journal_meta in &journals {
        existing_pages.insert(journal_meta.name.clone());
        nodes.push(GraphNode {
            id: journal_meta.name.clone(),
            label: journal_meta.title.clone(),
            is_journal: true,
            block_count: journal_meta.block_count,
        });
    }

    // Build edges from wiki-links
    for page_meta in &pages {
        if let Ok(page) = garden.file_manager.read_page(&page_meta.name).await {
            let links = page.all_wiki_links();
            for link in links {
                // Only create edge if target exists
                if existing_pages.contains(&link) {
                    let key = (page_meta.name.clone(), link.clone());
                    *edges_map.entry(key).or_insert(0) += 1;
                }
            }
        }
    }

    // Also check journals for links
    for journal_meta in &journals {
        if let Some(date) = journal_meta.journal_date {
            if let Ok(page) = garden.file_manager.read_journal(date).await {
                let links = page.all_wiki_links();
                for link in links {
                    if existing_pages.contains(&link) {
                        let key = (journal_meta.name.clone(), link.clone());
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

    Ok(Json(Graph { nodes, edges }))
}
