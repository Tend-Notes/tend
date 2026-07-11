// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Template routes - API for content type template files
//!
//! Templates are stored as `.md` files at `.tend/templates/{contentTypeId}.md`
//! using the same Page/Block format as regular pages. This allows the frontend
//! to reuse the existing editor for template editing.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use tend_core::Page;
use tracing::debug;

use crate::auth::AuthenticatedUser;
use crate::error::AppError;
use crate::routes::pages::UpdatePageRequest;
use crate::state::AppState;

use super::helpers::apply_block_updates;

/// Get a template for a content type
///
/// Returns the template as a Page JSON, or 404 if no template file exists.
pub async fn get_template(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Path(content_type_id): Path<String>,
) -> Result<Json<Page>, AppError> {
    // Prevent path traversal: content_type_id is used in the template file path.
    tend_storage::fs::validate_safe_name(&content_type_id)
        .map_err(|e| AppError::BadRequest(format!("Invalid content type id '{}': {}", content_type_id, e)))?;

    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;

    let template_path = garden
        .file_manager
        .root()
        .join(".tend")
        .join("templates")
        .join(format!("{}.md", content_type_id));

    if !template_path.exists() {
        return Err(AppError::NotFound(format!(
            "Template for content type '{}' not found",
            content_type_id
        )));
    }

    let content = tokio::fs::read_to_string(&template_path).await.map_err(|e| {
        AppError::Internal(format!("Failed to read template file: {}", e))
    })?;

    let page = tend_core::parser::parse_markdown(&content, &content_type_id)
        .map_err(|e| AppError::Internal(format!("Failed to parse template: {}", e)))?;

    debug!("Read template for content type: {}", content_type_id);
    Ok(Json(page))
}

/// Update (or create) a template for a content type
///
/// Accepts UpdatePageRequest (same as pages API) and writes to the template file.
pub async fn update_template(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Path(content_type_id): Path<String>,
    Json(req): Json<UpdatePageRequest>,
) -> Result<Json<Page>, AppError> {
    // Prevent path traversal: content_type_id is used in the template file path.
    tend_storage::fs::validate_safe_name(&content_type_id)
        .map_err(|e| AppError::BadRequest(format!("Invalid content type id '{}': {}", content_type_id, e)))?;

    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;

    let templates_dir = garden
        .file_manager
        .root()
        .join(".tend")
        .join("templates");

    // Ensure the templates directory exists
    tokio::fs::create_dir_all(&templates_dir).await.map_err(|e| {
        AppError::Internal(format!("Failed to create templates directory: {}", e))
    })?;

    let template_path = templates_dir.join(format!("{}.md", content_type_id));

    // Read existing template or create new
    let mut page = if template_path.exists() {
        let content = tokio::fs::read_to_string(&template_path).await.map_err(|e| {
            AppError::Internal(format!("Failed to read template file: {}", e))
        })?;
        tend_core::parser::parse_markdown(&content, &content_type_id)
            .map_err(|e| AppError::Internal(format!("Failed to parse template: {}", e)))?
    } else {
        Page::new(&content_type_id)
    };

    // Apply block updates (version check, clear, parse, add blocks, bump version)
    apply_block_updates(&mut page, req.blocks, req.version)?;

    // Serialize and write atomically
    // Note: Templates are not indexed (no search, link, or block index updates)
    let content = tend_core::serializer::serialize_page(&page);
    let tmp_path = template_path.with_extension("md.tmp");

    tokio::fs::write(&tmp_path, &content).await.map_err(|e| {
        AppError::Internal(format!("Failed to write template file: {}", e))
    })?;

    tokio::fs::rename(&tmp_path, &template_path).await.map_err(|e| {
        AppError::Internal(format!("Failed to rename template file: {}", e))
    })?;

    debug!(
        "Updated template for content type: {} (version {})",
        content_type_id, page.version
    );
    Ok(Json(page))
}

/// Delete a template for a content type
pub async fn delete_template(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Path(content_type_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Prevent path traversal: content_type_id is used in the template file path.
    tend_storage::fs::validate_safe_name(&content_type_id)
        .map_err(|e| AppError::BadRequest(format!("Invalid content type id '{}': {}", content_type_id, e)))?;

    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;

    let template_path = garden
        .file_manager
        .root()
        .join(".tend")
        .join("templates")
        .join(format!("{}.md", content_type_id));

    if !template_path.exists() {
        return Err(AppError::NotFound(format!(
            "Template for content type '{}' not found",
            content_type_id
        )));
    }

    tokio::fs::remove_file(&template_path).await.map_err(|e| {
        AppError::Internal(format!("Failed to delete template file: {}", e))
    })?;

    debug!("Deleted template for content type: {}", content_type_id);
    Ok(Json(serde_json::json!({
        "deleted": content_type_id
    })))
}

#[cfg(test)]
mod tests {
    // The template routes build `.tend/templates/{content_type_id}.md` from the
    // path param and now guard it with validate_safe_name. Assert that guard
    // rejects the traversal payloads those routes would otherwise write/read.
    use tend_storage::fs::validate_safe_name;

    #[test]
    fn rejects_path_traversal_content_type_ids() {
        for bad in ["../../../etc/passwd", "..", "/etc/passwd", "foo/../bar", "a\0b"] {
            assert!(validate_safe_name(bad).is_err(), "should reject {bad:?}");
        }
        assert!(validate_safe_name("meeting").is_ok());
    }
}
