// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Garden management routes

use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};

use chrono::{DateTime, Utc};

use tend_core::ContentType;

use crate::config::{base_dir, gardens_json_path, gardens_root};
use crate::error::AppError;
use crate::state::AppState;

/// Garden configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Garden {
    pub id: String,
    pub name: String,
    pub path: String,
    /// Whether this garden uses age encryption
    #[serde(default)]
    pub encrypted: bool,
    /// Whether full-text search is enabled.
    /// For encrypted gardens, enabling search creates a plaintext index in .tend/
    /// Defaults to true for unencrypted gardens, false for encrypted.
    #[serde(default = "default_search_enabled")]
    pub search_enabled: bool,
    /// Hours after last use before the search index is auto-deleted (encrypted gardens only).
    /// Set to 0 to disable auto-deletion. Default is 6 hours.
    #[serde(default = "default_index_ttl_hours")]
    pub index_ttl_hours: u32,
    /// Content types configured for this garden
    #[serde(default = "default_content_types")]
    pub content_types: Vec<ContentType>,
}

fn default_content_types() -> Vec<ContentType> {
    ContentType::defaults()
}

fn default_search_enabled() -> bool {
    true // Will be overridden to false for encrypted gardens at creation
}

fn default_index_ttl_hours() -> u32 {
    6
}

/// Archived garden (kept for 15 days before permanent removal)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchivedGarden {
    #[serde(flatten)]
    pub garden: Garden,
    pub archived_at: DateTime<Utc>,
}

/// Response for list gardens
#[derive(Debug, Serialize)]
pub struct GardensResponse {
    pub gardens: Vec<Garden>,
    pub active: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub archived: Vec<ArchivedGarden>,
}

/// Request to create a new garden
#[derive(Debug, Deserialize)]
pub struct CreateGardenRequest {
    pub name: String,
    pub path: String,
    /// Optional passphrase for encrypted gardens. If provided, the garden will be encrypted.
    pub passphrase: Option<String>,
    /// Whether to enable search for encrypted gardens.
    /// Ignored for unencrypted gardens (always enabled).
    /// When enabled, a plaintext search index is stored in .tend/
    #[serde(default)]
    pub search_enabled: Option<bool>,
    /// Hours after last use before the search index is auto-deleted.
    /// Only applies to encrypted gardens with search enabled.
    /// Set to 0 to disable auto-deletion. Default is 6 hours.
    #[serde(default)]
    pub index_ttl_hours: Option<u32>,
}

/// Request to switch active garden
#[derive(Debug, Deserialize)]
pub struct SwitchGardenRequest {
    pub id: String,
}

/// Request to unlock an encrypted garden
#[derive(Debug, Deserialize)]
pub struct UnlockGardenRequest {
    pub id: String,
    pub passphrase: String,
}

/// Request to rename a garden
#[derive(Debug, Deserialize)]
pub struct RenameGardenRequest {
    pub name: String,
}

/// Gardens config file structure
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct GardensConfig {
    gardens: Vec<Garden>,
    active: String,
    #[serde(default)]
    archived: Vec<ArchivedGarden>,
}

/// Get the gardens config file path (in the base directory)
fn gardens_config_path() -> PathBuf {
    gardens_json_path()
}

/// Load content types for the active garden (used by sheets routes)
pub fn load_content_types() -> Result<Vec<ContentType>, crate::error::AppError> {
    let config = load_gardens_config();
    let garden = config
        .gardens
        .iter()
        .find(|g| g.id == config.active)
        .ok_or_else(|| crate::error::AppError::NotFound("Active garden not found".to_string()))?;
    Ok(garden.content_types.clone())
}

/// Load gardens configuration, purging archives older than 15 days
fn load_gardens_config() -> GardensConfig {
    let path = gardens_config_path();
    let mut config = if path.exists() {
        match std::fs::read_to_string(&path) {
            Ok(content) => match serde_json::from_str(&content) {
                Ok(config) => config,
                Err(e) => {
                    tracing::warn!("Failed to parse gardens config: {}", e);
                    default_gardens_config()
                }
            },
            Err(e) => {
                tracing::warn!("Failed to read gardens config: {}", e);
                default_gardens_config()
            }
        }
    } else {
        default_gardens_config()
    };

    // Purge archives older than 15 days
    let cutoff = Utc::now() - chrono::Duration::days(15);
    let original_len = config.archived.len();
    config.archived.retain(|a| a.archived_at > cutoff);

    // Save if we purged anything
    if config.archived.len() != original_len {
        let _ = save_gardens_config(&config);
    }

    config
}

fn default_gardens_config() -> GardensConfig {
    let default_path = gardens_root().join("Notes");
    GardensConfig {
        gardens: vec![Garden {
            id: "default".to_string(),
            name: "Notes".to_string(),
            path: default_path.to_string_lossy().to_string(),
            encrypted: false,
            search_enabled: true,
            index_ttl_hours: 0, // No TTL for unencrypted gardens
            content_types: ContentType::defaults(),
        }],
        active: "default".to_string(),
        archived: vec![],
    }
}

/// Save gardens configuration with restrictive permissions
fn save_gardens_config(config: &GardensConfig) -> Result<(), std::io::Error> {
    let path = gardens_config_path();

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let content = serde_json::to_string_pretty(config)?;
    std::fs::write(&path, &content)?;

    // Set restrictive permissions (0600 - owner read/write only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = std::fs::Permissions::from_mode(0o600);
        std::fs::set_permissions(&path, permissions)?;
    }

    Ok(())
}

/// List all gardens
pub async fn list_gardens(
    State(_state): State<Arc<AppState>>,
) -> Result<Json<GardensResponse>, AppError> {
    let config = load_gardens_config();

    Ok(Json(GardensResponse {
        gardens: config.gardens,
        active: config.active,
        archived: config.archived,
    }))
}

/// Expand ~ to home directory in paths
fn expand_tilde(path: &str) -> PathBuf {
    if path.starts_with("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(&path[2..]);
        }
    } else if path == "~" {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home);
        }
    }
    PathBuf::from(path)
}

/// Create a new garden
pub async fn create_garden(
    State(_state): State<Arc<AppState>>,
    Json(req): Json<CreateGardenRequest>,
) -> Result<Json<Garden>, AppError> {
    let mut config = load_gardens_config();

    // Generate ID from name
    let id = req.name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>();

    // Check for duplicate ID
    if config.gardens.iter().any(|g| g.id == id) {
        return Err(AppError::BadRequest(format!("Garden '{}' already exists", req.name)));
    }

    // Expand ~ in path and create the garden directory
    let garden_path = expand_tilde(&req.path);
    if !garden_path.exists() {
        std::fs::create_dir_all(&garden_path)
            .map_err(|e| AppError::Internal(format!("Failed to create garden directory: {}", e)))?;

        // Create pages and journals subdirectories
        std::fs::create_dir_all(garden_path.join("pages"))
            .map_err(|e| AppError::Internal(format!("Failed to create pages directory: {}", e)))?;
        std::fs::create_dir_all(garden_path.join("journals"))
            .map_err(|e| AppError::Internal(format!("Failed to create journals directory: {}", e)))?;
    }

    // Create .garden-meta marker file for garden detection
    let garden_meta = serde_json::json!({
        "version": 1,
        "type": "tend-garden",
        "name": &req.name
    });
    std::fs::write(
        garden_path.join(".garden-meta"),
        serde_json::to_string_pretty(&garden_meta).unwrap(),
    )
    .map_err(|e| AppError::Internal(format!("Failed to create .garden-meta: {}", e)))?;

    // Store the expanded absolute path
    let encrypted = req.passphrase.is_some();

    // For encrypted gardens: search disabled by default, 6hr TTL if enabled
    // For unencrypted gardens: search always enabled, no TTL
    let (search_enabled, index_ttl_hours) = if encrypted {
        (
            req.search_enabled.unwrap_or(false), // Default OFF for encrypted
            req.index_ttl_hours.unwrap_or(6),    // Default 6 hours TTL
        )
    } else {
        (true, 0) // Always on, no TTL for unencrypted
    };

    let garden = Garden {
        id: id.clone(),
        name: req.name,
        path: garden_path.to_string_lossy().to_string(),
        encrypted,
        search_enabled,
        index_ttl_hours,
        content_types: ContentType::defaults(),
    };

    config.gardens.push(garden.clone());

    save_gardens_config(&config)
        .map_err(|e| AppError::Internal(format!("Failed to save gardens config: {}", e)))?;

    // If encrypted, store the passphrase hash for unlock verification
    // Note: The actual passphrase is needed at runtime to decrypt files,
    // so we create a test file to verify the passphrase on unlock
    if let Some(passphrase) = &req.passphrase {
        // Create a verification file that can be used to check the passphrase
        let verify_content = "tend-encryption-verification";
        let encrypted_verify = tend_storage::encrypt(verify_content, passphrase)
            .map_err(|e| AppError::Internal(format!("Failed to encrypt verification file: {}", e)))?;

        let verify_path = garden_path.join(".tend").join("encryption.verify");
        if let Some(parent) = verify_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::Internal(format!("Failed to create .tend directory: {}", e)))?;
        }
        std::fs::write(&verify_path, encrypted_verify)
            .map_err(|e| AppError::Internal(format!("Failed to write verification file: {}", e)))?;

        tracing::info!("Created encrypted garden: {}", garden.name);
    }

    Ok(Json(garden))
}

/// Archive a garden (moves to archived list, files preserved for 15 days)
pub async fn delete_garden(
    State(_state): State<Arc<AppState>>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut config = load_gardens_config();

    // Don't allow archiving the active garden
    if config.active == id {
        return Err(AppError::BadRequest("Cannot archive the active garden".to_string()));
    }

    // Don't allow archiving if it's the only garden
    if config.gardens.len() <= 1 {
        return Err(AppError::BadRequest("Cannot archive the only garden".to_string()));
    }

    // Find and remove the garden
    let garden_idx = config.gardens.iter().position(|g| g.id == id);
    let garden = match garden_idx {
        Some(idx) => config.gardens.remove(idx),
        None => return Err(AppError::NotFound(format!("Garden '{}' not found", id))),
    };

    // Add to archived list
    config.archived.push(ArchivedGarden {
        garden: garden.clone(),
        archived_at: Utc::now(),
    });

    save_gardens_config(&config)
        .map_err(|e| AppError::Internal(format!("Failed to save gardens config: {}", e)))?;

    Ok(Json(serde_json::json!({
        "archived": id,
        "message": "Garden archived. It will be permanently removed after 15 days."
    })))
}

/// Restore an archived garden
pub async fn restore_garden(
    State(_state): State<Arc<AppState>>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<Garden>, AppError> {
    let mut config = load_gardens_config();

    // Find and remove from archived
    let archived_idx = config.archived.iter().position(|a| a.garden.id == id);
    let archived = match archived_idx {
        Some(idx) => config.archived.remove(idx),
        None => return Err(AppError::NotFound(format!("Archived garden '{}' not found", id))),
    };

    // Check for ID conflict with existing garden
    if config.gardens.iter().any(|g| g.id == archived.garden.id) {
        return Err(AppError::BadRequest(format!(
            "A garden with ID '{}' already exists",
            archived.garden.id
        )));
    }

    // Restore to active gardens
    let garden = archived.garden;
    config.gardens.push(garden.clone());

    save_gardens_config(&config)
        .map_err(|e| AppError::Internal(format!("Failed to save gardens config: {}", e)))?;

    Ok(Json(garden))
}

/// Validate that a path is safe to delete as a garden directory.
/// Uses both whitelist (must be in allowed locations) AND blacklist (must not be system paths).
/// Returns an error message if unsafe, None if safe.
fn validate_garden_path_for_deletion(path: &PathBuf) -> Option<String> {
    let path_str = path.to_string_lossy();

    // === BLOCKLIST CHECKS (what we must NEVER delete) ===

    // Reject paths with wildcards or shell expansion characters
    if path_str.contains('*') || path_str.contains('?') || path_str.contains('[') {
        return Some("Garden path cannot contain wildcards".to_string());
    }

    // Reject paths with shell variable expansion
    if path_str.contains('$') {
        return Some("Garden path cannot contain variable references".to_string());
    }

    // Must be absolute path
    if !path.is_absolute() {
        return Some("Garden path must be absolute".to_string());
    }

    // Canonicalize to resolve symlinks and .. components
    let canonical = match path.canonicalize() {
        Ok(p) => p,
        Err(_) => {
            // If we can't canonicalize (path doesn't exist), use the original
            path.clone()
        }
    };

    // Critical paths that should never be deleted (blocklist)
    let forbidden_paths: Vec<PathBuf> = vec![
        PathBuf::from("/"),
        PathBuf::from("/home"),
        PathBuf::from("/root"),
        PathBuf::from("/var"),
        PathBuf::from("/etc"),
        PathBuf::from("/usr"),
        PathBuf::from("/bin"),
        PathBuf::from("/sbin"),
        PathBuf::from("/lib"),
        PathBuf::from("/lib64"),
        PathBuf::from("/opt"),
        PathBuf::from("/tmp"),
        PathBuf::from("/boot"),
        PathBuf::from("/dev"),
        PathBuf::from("/proc"),
        PathBuf::from("/sys"),
        PathBuf::from("/run"),
        PathBuf::from("/mnt"),
        PathBuf::from("/media"),
        PathBuf::from("/srv"),
    ];

    for forbidden in &forbidden_paths {
        if &canonical == forbidden {
            return Some(format!("Cannot delete system directory: {}", canonical.display()));
        }
    }

    // Protect user home directories themselves (e.g., /home/user but not /home/user/notes)
    if canonical.starts_with("/home") {
        let components: Vec<_> = canonical.components().collect();
        // /home/user = 3 components, shouldn't be deletable
        if components.len() <= 3 {
            return Some(format!("Cannot delete home directory: {}", canonical.display()));
        }
    }

    // Protect /root itself
    if canonical == PathBuf::from("/root") {
        return Some("Cannot delete root home directory".to_string());
    }

    // === ALLOWLIST CHECKS (where gardens CAN live) ===

    // Get the base directory and gardens root where Tend stores its data
    let tend_base_dir = base_dir();
    let base_dir_canonical = tend_base_dir.canonicalize().unwrap_or(tend_base_dir.clone());
    let tend_gardens_root = gardens_root();
    let gardens_root_canonical = tend_gardens_root
        .canonicalize()
        .unwrap_or(tend_gardens_root.clone());

    // Build list of allowed parent directories (gardens must be inside one of these)
    let mut allowed_roots: Vec<PathBuf> = vec![
        base_dir_canonical.clone(),           // TEND_BASE_DIR or default
        gardens_root_canonical.clone(),       // TEND_DATA_DIR/Gardens or TEND_BASE_DIR/Gardens
        PathBuf::from("/var/lib/tend"),       // System service mode
    ];

    // Add XDG and dotfile locations in user's home
    if let Ok(home) = std::env::var("HOME") {
        let home_path = PathBuf::from(&home);

        // ~/.tend (dotfile convention)
        allowed_roots.push(home_path.join(".tend"));

        // XDG_DATA_HOME/tend (defaults to ~/.local/share/tend, but respect override)
        if let Ok(xdg_data) = std::env::var("XDG_DATA_HOME") {
            allowed_roots.push(PathBuf::from(xdg_data).join("tend"));
        } else {
            allowed_roots.push(home_path.join(".local/share/tend"));
        }

        // XDG_STATE_HOME/tend (defaults to ~/.local/state/tend)
        if let Ok(xdg_state) = std::env::var("XDG_STATE_HOME") {
            allowed_roots.push(PathBuf::from(xdg_state).join("tend"));
        } else {
            allowed_roots.push(home_path.join(".local/state/tend"));
        }
    }

    // Canonicalize allowed roots for comparison
    let allowed_roots: Vec<PathBuf> = allowed_roots
        .into_iter()
        .map(|p| p.canonicalize().unwrap_or(p))
        .collect();

    // Check if the path is inside any allowed root
    let is_in_allowed_location = allowed_roots
        .iter()
        .any(|root| canonical.starts_with(root));

    if !is_in_allowed_location {
        return Some(format!(
            "Garden path must be within Tend's data directory (~/.local/share/tend, ~/.tend, or /var/lib/tend): {}",
            canonical.display()
        ));
    }

    // === STRUCTURAL CHECKS (must look like a garden) ===

    // Verify it looks like a garden (has pages or journals subdirectory)
    let has_pages = canonical.join("pages").exists();
    let has_journals = canonical.join("journals").exists();

    if !has_pages && !has_journals {
        return Some(format!(
            "Directory doesn't appear to be a garden (no pages/ or journals/ subdirectory): {}",
            canonical.display()
        ));
    }

    None
}

/// Permanently delete an archived garden (removes from archive AND deletes files from disk)
pub async fn delete_archived_garden(
    State(_state): State<Arc<AppState>>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut config = load_gardens_config();

    // Find and remove from archived
    let archived_idx = config.archived.iter().position(|a| a.garden.id == id);
    let archived = match archived_idx {
        Some(idx) => config.archived.remove(idx),
        None => return Err(AppError::NotFound(format!("Archived garden '{}' not found", id))),
    };

    // Delete the garden directory from disk
    let garden_path = PathBuf::from(&archived.garden.path);

    // Validate the path is safe to delete
    if let Some(error) = validate_garden_path_for_deletion(&garden_path) {
        return Err(AppError::BadRequest(error));
    }

    if garden_path.exists() {
        std::fs::remove_dir_all(&garden_path)
            .map_err(|e| AppError::Internal(format!("Failed to delete garden files: {}", e)))?;
        tracing::info!("Deleted garden directory: {}", garden_path.display());
    }

    save_gardens_config(&config)
        .map_err(|e| AppError::Internal(format!("Failed to save gardens config: {}", e)))?;

    Ok(Json(serde_json::json!({
        "deleted": id,
        "path": archived.garden.path,
        "message": "Garden permanently deleted."
    })))
}

/// Switch active garden (hot-reloads the garden state)
/// For encrypted gardens, returns a special response indicating unlock is required.
pub async fn switch_garden(
    State(state): State<Arc<AppState>>,
    Json(req): Json<SwitchGardenRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut config = load_gardens_config();

    // Verify the garden exists and check if encrypted
    let garden = config
        .gardens
        .iter()
        .find(|g| g.id == req.id)
        .ok_or_else(|| AppError::NotFound(format!("Garden '{}' not found", req.id)))?;

    // If encrypted, return unlock_required response
    if garden.encrypted {
        return Ok(Json(serde_json::json!({
            "unlock_required": true,
            "garden_id": req.id,
            "message": "This garden is encrypted. Please provide passphrase to unlock."
        })));
    }

    config.active = req.id.clone();

    save_gardens_config(&config)
        .map_err(|e| AppError::Internal(format!("Failed to save gardens config: {}", e)))?;

    // Hot-reload the garden state
    state
        .switch_garden(&req.id)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to switch garden: {}", e)))?;

    Ok(Json(serde_json::json!({
        "active": req.id,
        "message": "Garden switched successfully."
    })))
}

/// Unlock an encrypted garden with passphrase
pub async fn unlock_garden(
    State(state): State<Arc<AppState>>,
    Json(req): Json<UnlockGardenRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut config = load_gardens_config();

    // Verify the garden exists and is encrypted
    let garden = config
        .gardens
        .iter()
        .find(|g| g.id == req.id)
        .ok_or_else(|| AppError::NotFound(format!("Garden '{}' not found", req.id)))?;

    if !garden.encrypted {
        return Err(AppError::BadRequest(format!(
            "Garden '{}' is not encrypted",
            req.id
        )));
    }

    // Try to unlock with the provided passphrase
    match state
        .switch_garden_encrypted(&req.id, req.passphrase)
        .await
    {
        Ok(_) => {
            config.active = req.id.clone();
            save_gardens_config(&config)
                .map_err(|e| AppError::Internal(format!("Failed to save gardens config: {}", e)))?;

            Ok(Json(serde_json::json!({
                "active": req.id,
                "message": "Garden unlocked and switched successfully."
            })))
        }
        Err(e) => {
            let err_msg = e.to_string();
            if err_msg.contains("Invalid passphrase") {
                Err(AppError::Unauthorized("Invalid passphrase".to_string()))
            } else {
                Err(AppError::Internal(format!("Failed to unlock garden: {}", e)))
            }
        }
    }
}

/// Rename the active garden
pub async fn rename_garden(
    State(_state): State<Arc<AppState>>,
    Json(req): Json<RenameGardenRequest>,
) -> Result<Json<Garden>, AppError> {
    let mut config = load_gardens_config();

    // Find the active garden
    let active_id = config.active.clone();
    let garden = config
        .gardens
        .iter_mut()
        .find(|g| g.id == active_id)
        .ok_or_else(|| AppError::NotFound("Active garden not found".to_string()))?;

    // Update the name
    garden.name = req.name.clone();
    let updated_garden = garden.clone();

    // Also update the .garden-meta file
    let garden_path = std::path::PathBuf::from(&garden.path);
    let garden_meta = serde_json::json!({
        "version": 1,
        "type": "tend-garden",
        "name": &req.name
    });
    std::fs::write(
        garden_path.join(".garden-meta"),
        serde_json::to_string_pretty(&garden_meta).unwrap(),
    )
    .map_err(|e| AppError::Internal(format!("Failed to update .garden-meta: {}", e)))?;

    save_gardens_config(&config)
        .map_err(|e| AppError::Internal(format!("Failed to save gardens config: {}", e)))?;

    Ok(Json(updated_garden))
}

/// Get content types for the active garden
pub async fn get_content_types(
    State(_state): State<Arc<AppState>>,
) -> Result<Json<Vec<ContentType>>, AppError> {
    let config = load_gardens_config();

    let garden = config
        .gardens
        .iter()
        .find(|g| g.id == config.active)
        .ok_or_else(|| AppError::NotFound("Active garden not found".to_string()))?;

    Ok(Json(garden.content_types.clone()))
}

/// Request to update content types
#[derive(Debug, Deserialize)]
pub struct UpdateContentTypesRequest {
    pub content_types: Vec<ContentType>,
}

/// Update content types for the active garden
pub async fn update_content_types(
    State(_state): State<Arc<AppState>>,
    Json(req): Json<UpdateContentTypesRequest>,
) -> Result<Json<Vec<ContentType>>, AppError> {
    let mut config = load_gardens_config();

    // Validate: must have page and journal types
    let has_page = req.content_types.iter().any(|ct| ct.id == "page");
    let has_journal = req.content_types.iter().any(|ct| ct.id == "journal");

    if !has_page || !has_journal {
        return Err(AppError::BadRequest(
            "Content types must include 'page' and 'journal' types".to_string(),
        ));
    }

    // Validate: no duplicate IDs
    let mut seen_ids = std::collections::HashSet::new();
    for ct in &req.content_types {
        if !seen_ids.insert(&ct.id) {
            return Err(AppError::BadRequest(format!(
                "Duplicate content type ID: {}",
                ct.id
            )));
        }
    }

    // Validate: no duplicate directories
    let mut seen_dirs = std::collections::HashSet::new();
    for ct in &req.content_types {
        if !seen_dirs.insert(&ct.directory) {
            return Err(AppError::BadRequest(format!(
                "Duplicate content type directory: {}",
                ct.directory
            )));
        }
    }

    // Find and update the active garden
    let active_id = config.active.clone();
    let garden = config
        .gardens
        .iter_mut()
        .find(|g| g.id == active_id)
        .ok_or_else(|| AppError::NotFound("Active garden not found".to_string()))?;

    garden.content_types = req.content_types;
    let result = garden.content_types.clone();

    save_gardens_config(&config)
        .map_err(|e| AppError::Internal(format!("Failed to save gardens config: {}", e)))?;

    Ok(Json(result))
}
