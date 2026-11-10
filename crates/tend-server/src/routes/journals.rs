// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Journal API routes

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use chrono::NaiveDate;
use tend_core::{Page, PageMeta};
use tracing::debug;

use crate::auth::AuthenticatedUser;
use crate::error::AppError;
use crate::routes::pages::UpdatePageRequest;
use crate::state::AppState;
use crate::ws::{BroadcastEvent, WsEvent};

use super::helpers::{apply_block_updates, update_all_indices};

/// List all journals
pub async fn list_journals(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<Json<Vec<PageMeta>>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;
    let journals = garden.file_manager.list_journals().await?;
    Ok(Json(journals))
}

/// Get a journal by date
pub async fn get_journal(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Path(date_str): Path<String>,
) -> Result<Json<Page>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;
    let date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest(format!("Invalid date format: {}", date_str)))?;

    let page = garden.file_manager.read_journal(date).await?;
    Ok(Json(page))
}

/// Update a journal
pub async fn update_journal(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Path(date_str): Path<String>,
    Json(req): Json<UpdatePageRequest>,
) -> Result<Json<Page>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;
    let date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest(format!("Invalid date format: {}", date_str)))?;

    // Read existing journal or create new
    let mut page = garden
        .file_manager
        .read_journal(date)
        .await
        .unwrap_or_else(|_| Page::new_journal(date));

    // Apply block updates (version check, clear, parse, add blocks, bump version)
    apply_block_updates(&mut page, req.blocks, req.version)?;

    garden.file_manager.write_page(&page).await?;

    // Update all indices (search, link, block)
    update_all_indices(&garden, &page, "journal").await;

    // Broadcast update to other clients (ignore send errors - no receivers is ok)
    let _ = state.event_sender.send(BroadcastEvent {
        username: Some(user.username.clone()),
        event: WsEvent::PageUpdated {
            name: page.name.clone(),
        },
    });

    debug!("Updated journal: {} (version {})", date_str, page.version);
    Ok(Json(page))
}
