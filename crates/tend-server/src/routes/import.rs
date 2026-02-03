// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Import API routes for importing from other tools (Logseq)
//!
//! Supports zip file upload with streaming progress response.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Path as AxumPath, State};
use axum::http::header;
use axum::response::Response;
use axum::Json;
use axum_extra::extract::Multipart;
use futures_util::StreamExt;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tokio::fs;

use anyhow::Context;

use crate::auth::AuthenticatedUser;
use crate::error::AppError;
use crate::routes::gardens::load_user_content_types;
use crate::state::{AppState, UserState};

/// Maximum upload size: 500 MB
pub const MAX_UPLOAD_SIZE: usize = 500 * 1024 * 1024;

/// Progress event sent as JSON lines during import
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ImportProgress {
    /// Starting the import
    Started {
        message: String,
    },
    /// Extracting zip file
    Extracting {
        message: String,
    },
    /// Processing files
    Processing {
        current: usize,
        total: usize,
        file: String,
    },
    /// A file was imported successfully
    Imported {
        file: String,
        target: String,
    },
    /// A file was skipped (already exists)
    Skipped {
        file: String,
        reason: String,
    },
    /// A file failed to import
    Failed {
        file: String,
        error: String,
    },
    /// Logseq-specific syntax was transformed
    Transformed {
        file: String,
        transformations: Vec<String>,
    },
    /// Import completed
    Completed {
        pages_imported: usize,
        journals_imported: usize,
        skipped: usize,
        failed: usize,
        has_assets: bool,
    },
    /// Error during import
    Error {
        message: String,
    },
}

/// Import error stored in $garden/import-errors/
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportError {
    /// Original filename from the import
    pub original_name: String,
    /// Error reason
    pub error: String,
    /// Content of the file (markdown)
    pub content: String,
    /// Timestamp of the import attempt
    pub timestamp: String,
    /// Source (e.g., "logseq")
    pub source: String,
}

/// Metadata sidecar for import errors
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportErrorMeta {
    /// Original filename
    pub original_name: String,
    /// Error reason
    pub error: String,
    /// Timestamp
    pub timestamp: String,
    /// Source
    pub source: String,
}

/// List of import errors
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportErrorList {
    pub errors: Vec<ImportErrorSummary>,
}

/// Summary of an import error (for list view)
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportErrorSummary {
    /// Name (filename without extension)
    pub name: String,
    /// Original filename
    pub original_name: String,
    /// Error reason
    pub error: String,
    /// Timestamp
    pub timestamp: String,
}

/// Request to accept (save) an import error
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptErrorRequest {
    /// Content type to save to (e.g., "page", "journal", "meetings")
    pub content_type: String,
    /// Optional date for saveByDate content types
    pub date: Option<String>,
}

/// Import a Logseq zip file via multipart upload
///
/// Returns a streaming JSON lines response with progress updates.
pub async fn import_logseq_zip(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    mut multipart: Multipart,
) -> Result<Response, AppError> {
    // Get user state and garden path
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;
    let garden_path = garden.file_manager.root().to_path_buf();
    let errors_dir = garden_path.join("import-errors");
    drop(garden);

    // Create a channel for progress updates
    let (tx, rx) = tokio::sync::mpsc::channel::<ImportProgress>(32);

    // Process multipart upload
    let mut zip_data: Option<Vec<u8>> = None;
    let mut overwrite = false;
    let mut import_assets = false;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        AppError::BadRequest(format!("Failed to read multipart field: {}", e))
    })? {
        let name = field.name().unwrap_or_default().to_string();

        match name.as_str() {
            "file" => {
                // Read the zip file data
                let data = field.bytes().await.map_err(|e| {
                    AppError::BadRequest(format!("Failed to read file: {}", e))
                })?;

                if data.len() > MAX_UPLOAD_SIZE {
                    return Err(AppError::BadRequest(format!(
                        "File too large. Maximum size is {} MB",
                        MAX_UPLOAD_SIZE / 1024 / 1024
                    )));
                }

                zip_data = Some(data.to_vec());
            }
            "overwrite" => {
                let value = field.text().await.unwrap_or_default();
                overwrite = value == "true" || value == "1";
            }
            "importAssets" => {
                let value = field.text().await.unwrap_or_default();
                import_assets = value == "true" || value == "1";
            }
            _ => {}
        }
    }

    let zip_data = zip_data.ok_or_else(|| AppError::BadRequest("No file uploaded".to_string()))?;

    // Spawn the import task
    let tx_clone = tx.clone();
    tokio::spawn(async move {
        if let Err(e) = process_import(
            zip_data,
            garden_path,
            errors_dir,
            overwrite,
            import_assets,
            tx_clone.clone(),
            user_state,
        )
        .await
        {
            let _ = tx_clone
                .send(ImportProgress::Error {
                    message: e.to_string(),
                })
                .await;
        }
    });

    // Convert channel to stream
    let stream = tokio_stream::wrappers::ReceiverStream::new(rx).map(|progress| {
        let json = serde_json::to_string(&progress).unwrap_or_default();
        Ok::<_, std::convert::Infallible>(format!("{}\n", json))
    });

    // Return streaming response
    let body = Body::from_stream(stream);
    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "application/x-ndjson")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(body)
        .unwrap())
}

/// Process the import in a background task
async fn process_import(
    zip_data: Vec<u8>,
    garden_path: PathBuf,
    errors_dir: PathBuf,
    overwrite: bool,
    _import_assets: bool,
    tx: tokio::sync::mpsc::Sender<ImportProgress>,
    user_state: Arc<UserState>,
) -> anyhow::Result<()> {
    let _ = tx
        .send(ImportProgress::Started {
            message: "Starting import...".to_string(),
        })
        .await;

    // Create temp directory for extraction
    let temp_dir = tempfile::tempdir()?;
    let temp_path = temp_dir.path();

    let _ = tx
        .send(ImportProgress::Extracting {
            message: "Extracting zip file...".to_string(),
        })
        .await;

    // Extract zip file (blocking operation)
    let zip_data_clone = zip_data.clone();
    let temp_path_owned = temp_path.to_path_buf();
    tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
        let cursor = std::io::Cursor::new(zip_data_clone);
        let mut archive = zip::ZipArchive::new(cursor)?;

        for i in 0..archive.len() {
            let mut file = archive.by_index(i)?;
            let outpath = match file.enclosed_name() {
                Some(path) => temp_path_owned.join(path),
                None => continue,
            };

            if file.is_dir() {
                std::fs::create_dir_all(&outpath)?;
            } else {
                if let Some(p) = outpath.parent() {
                    if !p.exists() {
                        std::fs::create_dir_all(p)?;
                    }
                }
                let mut outfile = std::fs::File::create(&outpath)?;
                std::io::copy(&mut file, &mut outfile)?;
            }
        }
        Ok(())
    })
    .await??;

    // Find the Logseq graph root (may be nested in a folder)
    let graph_root = find_logseq_root(temp_path).await?;
    let has_assets = graph_root.join("assets").exists();

    // Collect all markdown files to import
    let mut files_to_import: Vec<(PathBuf, ImportTarget)> = Vec::new();

    // Process pages directory
    let pages_dir = graph_root.join("pages");
    if pages_dir.exists() {
        collect_markdown_files(&pages_dir, ImportTarget::Page, &mut files_to_import).await?;
    }

    // Process journals directory
    let journals_dir = graph_root.join("journals");
    if journals_dir.exists() {
        collect_markdown_files(&journals_dir, ImportTarget::Journal, &mut files_to_import).await?;
    }

    let total = files_to_import.len();
    let mut pages_imported = 0;
    let mut journals_imported = 0;
    let mut skipped = 0;
    let mut failed = 0;

    // Track imported files for link index update
    // Pages are tracked by name, journals by date string (YYYY-MM-DD)
    let mut imported_pages: Vec<String> = Vec::new();
    let mut imported_journals: Vec<String> = Vec::new();

    // Logseq journal date patterns
    let journal_date_regex = Regex::new(r"^(\d{4})[-_](\d{2})[-_](\d{2})\.md$").unwrap();
    let journal_date_verbose =
        Regex::new(r"^([A-Za-z]{3}) (\d{1,2})(?:st|nd|rd|th)?, (\d{4})\.md$").unwrap();

    // Ensure directories exist
    fs::create_dir_all(garden_path.join("pages")).await?;
    fs::create_dir_all(garden_path.join("journals")).await?;
    fs::create_dir_all(&errors_dir).await?;

    for (i, (file_path, target)) in files_to_import.iter().enumerate() {
        let file_name = file_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();

        let _ = tx
            .send(ImportProgress::Processing {
                current: i + 1,
                total,
                file: file_name.clone(),
            })
            .await;

        // Read file content
        let raw_content = match fs::read_to_string(&file_path).await {
            Ok(c) => c,
            Err(e) => {
                save_import_error(
                    &errors_dir,
                    &file_name,
                    &format!("Failed to read file: {}", e),
                    "",
                )
                .await?;
                let _ = tx
                    .send(ImportProgress::Failed {
                        file: file_name,
                        error: format!("Failed to read: {}", e),
                    })
                    .await;
                failed += 1;
                continue;
            }
        };

        // Transform Logseq-specific syntax
        let transform_result = transform_logseq_content(&raw_content);
        let content = transform_result.content;

        // Report transformations if any occurred
        if !transform_result.transformations.is_empty() {
            let _ = tx
                .send(ImportProgress::Transformed {
                    file: file_name.clone(),
                    transformations: transform_result.transformations,
                })
                .await;
        }

        // Determine destination path
        let dest_result = match target {
            ImportTarget::Page => {
                // Logseq uses URL-encoded file names, decode them
                let page_name = urlencoding::decode(file_name.trim_end_matches(".md"))
                    .unwrap_or_else(|_| file_name.trim_end_matches(".md").into())
                    .to_string();
                let dest_path = garden_path.join("pages").join(format!("{}.md", page_name));
                Ok((dest_path, page_name))
            }
            ImportTarget::Journal => {
                // Convert Logseq date format to Tend format (YYYY-MM-DD.md)
                if let Some(caps) = journal_date_regex.captures(&file_name) {
                    let dest_name = format!("{}-{}-{}.md", &caps[1], &caps[2], &caps[3]);
                    let dest_path = garden_path.join("journals").join(&dest_name);
                    Ok((dest_path, dest_name))
                } else if let Some(caps) = journal_date_verbose.captures(&file_name) {
                    let month = match &caps[1].to_lowercase()[..3] {
                        "jan" => "01",
                        "feb" => "02",
                        "mar" => "03",
                        "apr" => "04",
                        "may" => "05",
                        "jun" => "06",
                        "jul" => "07",
                        "aug" => "08",
                        "sep" => "09",
                        "oct" => "10",
                        "nov" => "11",
                        "dec" => "12",
                        _ => {
                            let _ = tx
                                .send(ImportProgress::Failed {
                                    file: file_name.clone(),
                                    error: "Unknown month format".to_string(),
                                })
                                .await;
                            failed += 1;
                            continue;
                        }
                    };
                    let day = format!("{:02}", caps[2].parse::<u32>().unwrap_or(1));
                    let dest_name = format!("{}-{}-{}.md", &caps[3], month, day);
                    let dest_path = garden_path.join("journals").join(&dest_name);
                    Ok((dest_path, dest_name))
                } else {
                    Err(format!("Unrecognized journal date format: {}", file_name))
                }
            }
        };

        let (dest_path, dest_name) = match dest_result {
            Ok(result) => result,
            Err(error) => {
                save_import_error(&errors_dir, &file_name, &error, &content).await?;
                let _ = tx
                    .send(ImportProgress::Failed {
                        file: file_name,
                        error,
                    })
                    .await;
                failed += 1;
                continue;
            }
        };

        // Check if file already exists
        if dest_path.exists() && !overwrite {
            let _ = tx
                .send(ImportProgress::Skipped {
                    file: file_name,
                    reason: "File already exists".to_string(),
                })
                .await;
            skipped += 1;
            continue;
        }

        // Write the file
        match fs::write(&dest_path, &content).await {
            Ok(_) => {
                let _ = tx
                    .send(ImportProgress::Imported {
                        file: file_name,
                        target: dest_name.clone(),
                    })
                    .await;
                match target {
                    ImportTarget::Page => {
                        // For pages, dest_name is the page name (without .md)
                        imported_pages.push(dest_name);
                        pages_imported += 1;
                    }
                    ImportTarget::Journal => {
                        // For journals, dest_name is filename like "2024-01-15.md"
                        // Extract the date string (YYYY-MM-DD)
                        let date_str = dest_name.trim_end_matches(".md").to_string();
                        imported_journals.push(date_str);
                        journals_imported += 1;
                    }
                }
            }
            Err(e) => {
                save_import_error(
                    &errors_dir,
                    &file_name,
                    &format!("Failed to write file: {}", e),
                    &content,
                )
                .await?;
                let _ = tx
                    .send(ImportProgress::Failed {
                        file: file_name,
                        error: format!("Failed to write: {}", e),
                    })
                    .await;
                failed += 1;
            }
        }
    }

    // Update link index for all imported pages and journals
    // This ensures tags and wiki-links are indexed for backlink queries
    if !imported_pages.is_empty() || !imported_journals.is_empty() {
        let garden = user_state.garden.read().await;
        let mut link_index = garden.link_index.write().await;

        // Index imported pages
        for page_name in &imported_pages {
            match garden.file_manager.read_page(page_name).await {
                Ok(page) => {
                    let blocks: Vec<_> = page.blocks.values().cloned().collect();
                    if let Err(e) = link_index.index_page(&page.name, &blocks).await {
                        tracing::warn!("Failed to update link index for imported page {}: {}", page_name, e);
                    }
                }
                Err(e) => {
                    tracing::warn!("Failed to read imported page {} for indexing: {}", page_name, e);
                }
            }
        }

        // Index imported journals
        for date_str in &imported_journals {
            if let Ok(date) = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
                match garden.file_manager.read_journal(date).await {
                    Ok(page) => {
                        let blocks: Vec<_> = page.blocks.values().cloned().collect();
                        if let Err(e) = link_index.index_page(&page.name, &blocks).await {
                            tracing::warn!("Failed to update link index for imported journal {}: {}", date_str, e);
                        }
                    }
                    Err(e) => {
                        tracing::warn!("Failed to read imported journal {} for indexing: {}", date_str, e);
                    }
                }
            }
        }
    }

    let _ = tx
        .send(ImportProgress::Completed {
            pages_imported,
            journals_imported,
            skipped,
            failed,
            has_assets,
        })
        .await;

    Ok(())
}

#[derive(Clone, Copy)]
enum ImportTarget {
    Page,
    Journal,
}

/// Find the Logseq graph root directory (handles nested folders in zip)
async fn find_logseq_root(temp_path: &Path) -> anyhow::Result<PathBuf> {
    // Check if pages or journals exist at root level
    if temp_path.join("pages").exists() || temp_path.join("journals").exists() {
        return Ok(temp_path.to_path_buf());
    }

    // Check one level deep for a folder containing pages/journals
    let mut entries = fs::read_dir(temp_path).await?;
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.is_dir() {
            if path.join("pages").exists() || path.join("journals").exists() {
                return Ok(path);
            }
        }
    }

    // Return temp_path as fallback
    Ok(temp_path.to_path_buf())
}

/// Collect markdown files from a directory
async fn collect_markdown_files(
    dir: &Path,
    target: ImportTarget,
    files: &mut Vec<(PathBuf, ImportTarget)>,
) -> anyhow::Result<()> {
    let mut entries = fs::read_dir(dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("md") {
            files.push((path, target));
        }
    }
    Ok(())
}

/// Save a failed import to the errors directory
async fn save_import_error(
    errors_dir: &Path,
    original_name: &str,
    error: &str,
    content: &str,
) -> anyhow::Result<()> {
    // Generate a safe filename from the original name
    let safe_name = original_name
        .trim_end_matches(".md")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_' || *c == ' ')
        .collect::<String>()
        .replace(' ', "-");
    let safe_name = if safe_name.is_empty() {
        format!("unnamed-{}", chrono::Utc::now().timestamp_millis())
    } else {
        safe_name
    };

    // Write content file
    let content_path = errors_dir.join(format!("{}.md", safe_name));
    fs::write(&content_path, content).await?;

    // Write metadata sidecar
    let meta = ImportErrorMeta {
        original_name: original_name.to_string(),
        error: error.to_string(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        source: "logseq".to_string(),
    };
    let meta_path = errors_dir.join(format!("{}.meta.json", safe_name));
    let meta_json = serde_json::to_string_pretty(&meta)?;
    fs::write(&meta_path, meta_json).await?;

    Ok(())
}

/// List import errors
pub async fn list_import_errors(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<Json<ImportErrorList>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;
    let errors_dir = garden.file_manager.root().join("import-errors");
    drop(garden);

    let mut errors = Vec::new();

    if errors_dir.exists() {
        let mut entries = fs::read_dir(&errors_dir).await.context("Failed to read import-errors directory")?;

        while let Some(entry) = entries.next_entry().await.context("Failed to read entry")? {
            let path = entry.path();

            // Look for .meta.json files
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    if stem.ends_with(".meta") {
                        let name = stem.trim_end_matches(".meta").to_string();

                        // Read metadata
                        if let Ok(meta_content) = fs::read_to_string(&path).await {
                            if let Ok(meta) = serde_json::from_str::<ImportErrorMeta>(&meta_content) {
                                errors.push(ImportErrorSummary {
                                    name,
                                    original_name: meta.original_name,
                                    error: meta.error,
                                    timestamp: meta.timestamp,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // Sort by timestamp descending
    errors.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    Ok(Json(ImportErrorList { errors }))
}

/// Get a specific import error with content
pub async fn get_import_error(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    AxumPath(name): AxumPath<String>,
) -> Result<Json<ImportError>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;
    let errors_dir = garden.file_manager.root().join("import-errors");
    drop(garden);

    let content_path = errors_dir.join(format!("{}.md", name));
    let meta_path = errors_dir.join(format!("{}.meta.json", name));

    if !content_path.exists() || !meta_path.exists() {
        return Err(AppError::NotFound(format!("Import error not found: {}", name)));
    }

    let content = fs::read_to_string(&content_path)
        .await
        .context("Failed to read content file")?;
    let meta_content = fs::read_to_string(&meta_path)
        .await
        .context("Failed to read metadata file")?;
    let meta: ImportErrorMeta =
        serde_json::from_str(&meta_content).context("Failed to parse metadata")?;

    Ok(Json(ImportError {
        original_name: meta.original_name,
        error: meta.error,
        content,
        timestamp: meta.timestamp,
        source: meta.source,
    }))
}

/// Delete an import error
pub async fn delete_import_error(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    AxumPath(name): AxumPath<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;
    let errors_dir = garden.file_manager.root().join("import-errors");
    drop(garden);

    let content_path = errors_dir.join(format!("{}.md", name));
    let meta_path = errors_dir.join(format!("{}.meta.json", name));

    if !content_path.exists() {
        return Err(AppError::NotFound(format!("Import error not found: {}", name)));
    }

    // Delete both files
    if content_path.exists() {
        fs::remove_file(&content_path).await.context("Failed to delete content file")?;
    }
    if meta_path.exists() {
        fs::remove_file(&meta_path).await.context("Failed to delete meta file")?;
    }

    Ok(Json(serde_json::json!({ "deleted": name })))
}

/// Delete all import errors
pub async fn delete_all_import_errors(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;
    let errors_dir = garden.file_manager.root().join("import-errors");
    drop(garden);

    let mut deleted = 0;

    if errors_dir.exists() {
        let mut entries = fs::read_dir(&errors_dir).await.context("Failed to read errors directory")?;
        while let Some(entry) = entries.next_entry().await.context("Failed to read entry")? {
            let path = entry.path();
            if path.is_file() {
                fs::remove_file(&path).await.context("Failed to remove file")?;
                deleted += 1;
            }
        }
    }

    Ok(Json(serde_json::json!({ "deleted": deleted / 2 }))) // Divide by 2 since each error has 2 files
}

/// Accept (save) an import error to a content type
pub async fn accept_import_error(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    AxumPath(name): AxumPath<String>,
    Json(req): Json<AcceptErrorRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;
    let garden_path = garden.file_manager.root().to_path_buf();
    let errors_dir = garden_path.join("import-errors");
    drop(garden);

    // Get content types to find the target directory
    let content_types = load_user_content_types(&user.username)?;
    let content_type = content_types
        .iter()
        .find(|ct| ct.id == req.content_type)
        .ok_or_else(|| AppError::BadRequest(format!("Unknown content type: {}", req.content_type)))?
        .clone();

    let content_path = errors_dir.join(format!("{}.md", name));
    let meta_path = errors_dir.join(format!("{}.meta.json", name));

    if !content_path.exists() {
        return Err(AppError::NotFound(format!("Import error not found: {}", name)));
    }

    // Read content
    let content = fs::read_to_string(&content_path)
        .await
        .context("Failed to read content file")?;

    // Read metadata to get original name for the new file
    let meta_content = fs::read_to_string(&meta_path)
        .await
        .context("Failed to read metadata file")?;
    let meta: ImportErrorMeta =
        serde_json::from_str(&meta_content).context("Failed to parse metadata")?;

    // Determine destination path
    let dest_dir = if content_type.save_by_date {
        let date = req.date.unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d").to_string());
        garden_path.join(&content_type.directory).join(&date)
    } else {
        garden_path.join(&content_type.directory)
    };

    // Ensure directory exists
    tokio::fs::create_dir_all(&dest_dir).await.context("Failed to create destination directory")?;

    // Use a sanitized version of the original name
    let file_name = meta.original_name
        .trim_end_matches(".md")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_' || *c == ' ')
        .collect::<String>()
        .replace(' ', "-");
    let file_name = if file_name.is_empty() { name.clone() } else { file_name };

    let dest_path = dest_dir.join(format!("{}.md", file_name));

    // Check if destination already exists
    if dest_path.exists() {
        return Err(AppError::BadRequest(format!(
            "File already exists: {}",
            dest_path.display()
        )));
    }

    // Write to destination
    tokio::fs::write(&dest_path, &content).await.context("Failed to write destination file")?;

    // Delete the error files
    fs::remove_file(&content_path).await.context("Failed to delete error content file")?;
    fs::remove_file(&meta_path).await.context("Failed to delete error meta file")?;

    Ok(Json(serde_json::json!({
        "saved": file_name,
        "contentType": req.content_type,
        "path": dest_path.to_string_lossy()
    })))
}

// Keep the old function signature for backwards compatibility during transition
// This will be removed once the frontend is updated

/// Request to import a Logseq graph (legacy - path-based)
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportLogseqRequest {
    /// Path to the Logseq graph directory
    pub source_path: String,
    /// Whether to overwrite existing files
    #[serde(default)]
    pub overwrite: bool,
    /// Dry run - just report what would be imported
    #[serde(default)]
    pub dry_run: bool,
}

/// Result of an import operation (legacy)
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    /// Number of pages imported
    pub pages_imported: usize,
    /// Number of journals imported
    pub journals_imported: usize,
    /// Number of files skipped (already exist)
    pub skipped: usize,
    /// Broken links found (links to non-existent pages)
    pub broken_links: Vec<BrokenLink>,
    /// Warnings during import
    pub warnings: Vec<String>,
    /// Whether this was a dry run
    pub dry_run: bool,
}

/// A broken link reference
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokenLink {
    /// File containing the broken link
    pub source_file: String,
    /// The target that doesn't exist
    pub target: String,
}

/// Import a Logseq graph (legacy path-based API)
pub async fn import_logseq(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Json(req): Json<ImportLogseqRequest>,
) -> Result<Json<ImportResult>, AppError> {
    let source_path = PathBuf::from(&req.source_path);

    // Validate source path exists
    if !source_path.exists() {
        return Err(AppError::BadRequest(format!(
            "Source path does not exist: {}",
            req.source_path
        )));
    }

    let user_state = state.get_user_state(&user.username).await?;
    let garden = user_state.garden.read().await;
    let garden_path = garden.file_manager.root().to_path_buf();

    let mut pages_imported = 0;
    let mut journals_imported = 0;
    let mut skipped = 0;
    let mut warnings = Vec::new();
    let mut all_targets: HashSet<String> = HashSet::new();
    let mut all_links: Vec<(String, String)> = Vec::new();

    // Logseq journal date patterns
    let journal_date_regex = Regex::new(r"^(\d{4})[-_](\d{2})[-_](\d{2})\.md$").unwrap();
    let journal_date_verbose =
        Regex::new(r"^([A-Za-z]{3}) (\d{1,2})(?:st|nd|rd|th)?, (\d{4})\.md$").unwrap();

    // Process pages directory
    let pages_dir = source_path.join("pages");
    if pages_dir.exists() {
        let mut entries = fs::read_dir(&pages_dir)
            .await
            .context("Failed to read pages directory")?;
        while let Some(entry) = entries
            .next_entry()
            .await
            .context("Failed to read directory entry")?
        {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }

            let file_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default();

            // Logseq uses URL-encoded file names, decode them
            let page_name = urlencoding::decode(file_name.trim_end_matches(".md"))
                .unwrap_or_else(|_| file_name.trim_end_matches(".md").into())
                .to_string();

            all_targets.insert(page_name.clone());

            let dest_path = garden_path.join("pages").join(format!("{}.md", page_name));

            // Check if already exists
            if dest_path.exists() && !req.overwrite {
                skipped += 1;
                continue;
            }

            // Read content and extract links
            let raw_content = fs::read_to_string(&path)
                .await
                .context(format!("Failed to read file: {}", path.display()))?;

            // Transform Logseq-specific syntax
            let transform_result = transform_logseq_content(&raw_content);
            let content = transform_result.content;
            if !transform_result.transformations.is_empty() {
                for t in &transform_result.transformations {
                    warnings.push(format!("{}: {}", file_name, t));
                }
            }

            extract_wiki_links(&content, file_name, &mut all_links);

            if !req.dry_run {
                // Ensure pages directory exists
                fs::create_dir_all(garden_path.join("pages"))
                    .await
                    .context("Failed to create pages directory")?;
                fs::write(&dest_path, &content)
                    .await
                    .context(format!("Failed to write file: {}", dest_path.display()))?;
            }

            pages_imported += 1;
        }
    }

    // Process journals directory
    let journals_dir = source_path.join("journals");
    if journals_dir.exists() {
        let mut entries = fs::read_dir(&journals_dir)
            .await
            .context("Failed to read journals directory")?;
        while let Some(entry) = entries
            .next_entry()
            .await
            .context("Failed to read directory entry")?
        {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }

            let file_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default();

            // Convert Logseq date format to Tend format (YYYY-MM-DD.md)
            let dest_name = if let Some(caps) = journal_date_regex.captures(file_name) {
                // Already in YYYY-MM-DD or YYYY_MM_DD format
                format!("{}-{}-{}.md", &caps[1], &caps[2], &caps[3])
            } else if let Some(caps) = journal_date_verbose.captures(file_name) {
                // Verbose format like "Jan 15th, 2024.md"
                let month = match &caps[1].to_lowercase()[..3] {
                    "jan" => "01",
                    "feb" => "02",
                    "mar" => "03",
                    "apr" => "04",
                    "may" => "05",
                    "jun" => "06",
                    "jul" => "07",
                    "aug" => "08",
                    "sep" => "09",
                    "oct" => "10",
                    "nov" => "11",
                    "dec" => "12",
                    _ => {
                        warnings.push(format!("Unknown month in journal: {}", file_name));
                        continue;
                    }
                };
                let day = format!("{:02}", caps[2].parse::<u32>().unwrap_or(1));
                format!("{}-{}-{}.md", &caps[3], month, day)
            } else {
                warnings.push(format!("Unrecognized journal date format: {}", file_name));
                continue;
            };

            // Extract date for target tracking
            let date_part = dest_name.trim_end_matches(".md");
            all_targets.insert(date_part.to_string());

            let dest_path = garden_path.join("journals").join(&dest_name);

            // Check if already exists
            if dest_path.exists() && !req.overwrite {
                skipped += 1;
                continue;
            }

            // Read content and extract links
            let raw_content = fs::read_to_string(&path)
                .await
                .context(format!("Failed to read file: {}", path.display()))?;

            // Transform Logseq-specific syntax
            let transform_result = transform_logseq_content(&raw_content);
            let content = transform_result.content;
            if !transform_result.transformations.is_empty() {
                for t in &transform_result.transformations {
                    warnings.push(format!("{}: {}", file_name, t));
                }
            }

            extract_wiki_links(&content, file_name, &mut all_links);

            if !req.dry_run {
                // Ensure journals directory exists
                fs::create_dir_all(garden_path.join("journals"))
                    .await
                    .context("Failed to create journals directory")?;
                fs::write(&dest_path, &content)
                    .await
                    .context(format!("Failed to write file: {}", dest_path.display()))?;
            }

            journals_imported += 1;
        }
    }

    // Find broken links
    let broken_links: Vec<BrokenLink> = all_links
        .into_iter()
        .filter(|(_, target)| !all_targets.contains(target))
        .map(|(source, target)| BrokenLink {
            source_file: source,
            target,
        })
        .collect();

    // Trigger reindex if we imported anything
    if !req.dry_run && (pages_imported > 0 || journals_imported > 0) {
        drop(garden);
        // Search index will be updated by file watcher
    }

    Ok(Json(ImportResult {
        pages_imported,
        journals_imported,
        skipped,
        broken_links,
        warnings,
        dry_run: req.dry_run,
    }))
}

/// Extract wiki-links from content
fn extract_wiki_links(content: &str, source_file: &str, links: &mut Vec<(String, String)>) {
    let link_regex = Regex::new(r"\[\[([^\]]+)\]\]").unwrap();
    for cap in link_regex.captures_iter(content) {
        let target = cap[1].to_string();
        // Skip block references and embeds
        if !target.starts_with("((") && !target.starts_with("{{") {
            links.push((source_file.to_string(), target));
        }
    }
}

/// Result of transforming Logseq-specific content
#[derive(Debug)]
pub struct TransformResult {
    /// The transformed content
    pub content: String,
    /// List of transformations applied (for logging)
    pub transformations: Vec<String>,
}

/// Transform Logseq-specific syntax that won't work in Tend
///
/// Handles:
/// - `{{query ...}}` blocks - Removed entirely
/// - `#+BEGIN_QUERY ... #+END_QUERY` org-mode blocks - Removed entirely
/// - `{{embed [[Page]]}}` - Converted to `[[Page]]`
/// - `{{embed ((block-id))}}` - Converted to `((block-id))`
/// - `{{cloze ...}}` - Stripped wrapper, kept content
/// - Other `{{...}}` macros - Stripped with comment
pub fn transform_logseq_content(content: &str) -> TransformResult {
    let mut result = content.to_string();
    let mut transformations = Vec::new();

    // Pattern for #+BEGIN_QUERY ... #+END_QUERY org-mode style blocks (case insensitive, multiline)
    // The content may start on the same line as BEGIN_QUERY or on the next line
    let org_query_regex =
        Regex::new(r"(?is)#\+BEGIN_QUERY[\s\S]*?#\+END_QUERY").unwrap();
    let org_query_count = org_query_regex.find_iter(&result).count();
    if org_query_count > 0 {
        result = org_query_regex
            .replace_all(&result, "<!-- Logseq query removed -->")
            .to_string();
        transformations.push(format!(
            "Removed {} org-mode query block(s)",
            org_query_count
        ));
    }

    // Pattern for {{query ...}} - can span multiple lines
    // Match balanced braces using a simple approach: match until closing }}
    let query_regex = Regex::new(r"(?s)\{\{query\s[^}]*\}\}").unwrap();
    let query_count = query_regex.find_iter(&result).count();
    if query_count > 0 {
        result = query_regex
            .replace_all(&result, "<!-- Logseq query removed -->")
            .to_string();
        transformations.push(format!("Removed {} query block(s)", query_count));
    }

    // Pattern for {{embed [[Page]]}} - convert to regular link
    let embed_page_regex = Regex::new(r"\{\{embed\s+\[\[([^\]]+)\]\]\s*\}\}").unwrap();
    let embed_page_count = embed_page_regex.find_iter(&result).count();
    if embed_page_count > 0 {
        result = embed_page_regex.replace_all(&result, "[[$1]]").to_string();
        transformations.push(format!(
            "Converted {} page embed(s) to links",
            embed_page_count
        ));
    }

    // Pattern for {{embed ((block-id))}} - convert to block reference
    let embed_block_regex = Regex::new(r"\{\{embed\s+\(\(([^)]+)\)\)\s*\}\}").unwrap();
    let embed_block_count = embed_block_regex.find_iter(&result).count();
    if embed_block_count > 0 {
        result = embed_block_regex
            .replace_all(&result, "(($1))")
            .to_string();
        transformations.push(format!(
            "Converted {} block embed(s) to references",
            embed_block_count
        ));
    }

    // Pattern for {{cloze content}} - keep content, strip wrapper
    let cloze_regex = Regex::new(r"\{\{cloze\s+([^}]+)\}\}").unwrap();
    let cloze_count = cloze_regex.find_iter(&result).count();
    if cloze_count > 0 {
        result = cloze_regex.replace_all(&result, "$1").to_string();
        transformations.push(format!("Stripped {} cloze wrapper(s)", cloze_count));
    }

    // Pattern for {{video ...}} - convert to link or comment
    let video_regex = Regex::new(r"\{\{video\s+([^}]+)\}\}").unwrap();
    let video_count = video_regex.find_iter(&result).count();
    if video_count > 0 {
        result = video_regex
            .replace_all(&result, "<!-- Video: $1 -->")
            .to_string();
        transformations.push(format!("Commented out {} video macro(s)", video_count));
    }

    // Pattern for {{youtube ...}} - convert to link
    let youtube_regex = Regex::new(r"\{\{youtube\s+([^}]+)\}\}").unwrap();
    let youtube_count = youtube_regex.find_iter(&result).count();
    if youtube_count > 0 {
        result = youtube_regex
            .replace_all(&result, "[YouTube video]($1)")
            .to_string();
        transformations.push(format!(
            "Converted {} YouTube macro(s) to links",
            youtube_count
        ));
    }

    // Pattern for {{tweet ...}} - convert to link
    let tweet_regex = Regex::new(r"\{\{tweet\s+([^}]+)\}\}").unwrap();
    let tweet_count = tweet_regex.find_iter(&result).count();
    if tweet_count > 0 {
        result = tweet_regex
            .replace_all(&result, "[Tweet]($1)")
            .to_string();
        transformations.push(format!("Converted {} tweet macro(s) to links", tweet_count));
    }

    // Pattern for {{renderer ...}} - comment out
    let renderer_regex = Regex::new(r"\{\{renderer\s+[^}]*\}\}").unwrap();
    let renderer_count = renderer_regex.find_iter(&result).count();
    if renderer_count > 0 {
        result = renderer_regex
            .replace_all(&result, "<!-- Logseq renderer removed -->")
            .to_string();
        transformations.push(format!("Removed {} renderer macro(s)", renderer_count));
    }

    // Pattern for {{cards ...}} - comment out
    let cards_regex = Regex::new(r"\{\{cards\s+[^}]*\}\}").unwrap();
    let cards_count = cards_regex.find_iter(&result).count();
    if cards_count > 0 {
        result = cards_regex
            .replace_all(&result, "<!-- Logseq cards removed -->")
            .to_string();
        transformations.push(format!("Removed {} cards macro(s)", cards_count));
    }

    // Generic pattern for remaining {{...}} macros - comment them out
    // This catches anything we haven't explicitly handled
    let generic_macro_regex = Regex::new(r"\{\{([a-zA-Z][a-zA-Z0-9-_]*)\s*([^}]*)\}\}").unwrap();
    let remaining_macros: Vec<String> = generic_macro_regex
        .captures_iter(&result)
        .map(|cap| cap[1].to_string())
        .collect();
    if !remaining_macros.is_empty() {
        let unique_macros: std::collections::HashSet<_> = remaining_macros.iter().collect();
        result = generic_macro_regex
            .replace_all(&result, "<!-- Logseq macro {{$1}} removed -->")
            .to_string();
        transformations.push(format!(
            "Removed {} other macro(s): {}",
            remaining_macros.len(),
            unique_macros
                .iter()
                .map(|s| s.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }

    TransformResult {
        content: result,
        transformations,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transform_query_block() {
        let content = "Some text\n{{query (and [[Project]] (task todo))}}\nMore text";
        let result = transform_logseq_content(content);
        assert_eq!(
            result.content,
            "Some text\n<!-- Logseq query removed -->\nMore text"
        );
        assert_eq!(result.transformations.len(), 1);
        assert!(result.transformations[0].contains("query"));
    }

    #[test]
    fn test_transform_org_mode_query_block() {
        let content = r#"Some text
#+BEGIN_QUERY
{
  :title "Recent Tasks"
  :query [:find (pull ?b [*])
          :where
          [?b :block/marker ?m]
          [(contains? #{"TODO" "DOING"} ?m)]]
}
#+END_QUERY
More text"#;
        let result = transform_logseq_content(content);
        assert_eq!(
            result.content,
            "Some text\n<!-- Logseq query removed -->\nMore text"
        );
        assert_eq!(result.transformations.len(), 1);
        assert!(result.transformations[0].contains("org-mode query"));
    }

    #[test]
    fn test_transform_org_mode_query_block_case_insensitive() {
        let content = "#+begin_query\n{:query []}\n#+end_query";
        let result = transform_logseq_content(content);
        assert_eq!(result.content, "<!-- Logseq query removed -->");
        assert!(result.transformations[0].contains("org-mode query"));
    }

    #[test]
    fn test_transform_embed_page() {
        let content = "Check this: {{embed [[My Page]]}} for details";
        let result = transform_logseq_content(content);
        assert_eq!(result.content, "Check this: [[My Page]] for details");
        assert_eq!(result.transformations.len(), 1);
        assert!(result.transformations[0].contains("page embed"));
    }

    #[test]
    fn test_transform_embed_block() {
        let content = "Reference: {{embed ((block-uuid-123))}}";
        let result = transform_logseq_content(content);
        assert_eq!(result.content, "Reference: ((block-uuid-123))");
        assert_eq!(result.transformations.len(), 1);
        assert!(result.transformations[0].contains("block embed"));
    }

    #[test]
    fn test_transform_cloze() {
        let content = "The capital of France is {{cloze Paris}}.";
        let result = transform_logseq_content(content);
        assert_eq!(result.content, "The capital of France is Paris.");
        assert_eq!(result.transformations.len(), 1);
        assert!(result.transformations[0].contains("cloze"));
    }

    #[test]
    fn test_transform_youtube() {
        let content = "Watch this: {{youtube https://youtube.com/watch?v=abc123}}";
        let result = transform_logseq_content(content);
        assert_eq!(
            result.content,
            "Watch this: [YouTube video](https://youtube.com/watch?v=abc123)"
        );
        assert_eq!(result.transformations.len(), 1);
        assert!(result.transformations[0].contains("YouTube"));
    }

    #[test]
    fn test_transform_tweet() {
        let content = "See tweet: {{tweet https://twitter.com/user/status/123}}";
        let result = transform_logseq_content(content);
        assert_eq!(
            result.content,
            "See tweet: [Tweet](https://twitter.com/user/status/123)"
        );
    }

    #[test]
    fn test_transform_renderer() {
        let content = "Task: {{renderer :todomaster}}";
        let result = transform_logseq_content(content);
        assert_eq!(result.content, "Task: <!-- Logseq renderer removed -->");
    }

    #[test]
    fn test_transform_cards() {
        let content = "Study: {{cards [[Vocabulary]]}}";
        let result = transform_logseq_content(content);
        assert_eq!(result.content, "Study: <!-- Logseq cards removed -->");
    }

    #[test]
    fn test_transform_video() {
        let content = "Video: {{video https://example.com/video.mp4}}";
        let result = transform_logseq_content(content);
        assert_eq!(
            result.content,
            "Video: <!-- Video: https://example.com/video.mp4 -->"
        );
    }

    #[test]
    fn test_transform_unknown_macro() {
        let content = "Custom: {{myplugin some args}}";
        let result = transform_logseq_content(content);
        assert_eq!(
            result.content,
            "Custom: <!-- Logseq macro {{myplugin}} removed -->"
        );
        assert!(result.transformations[0].contains("myplugin"));
    }

    #[test]
    fn test_no_transformation_needed() {
        let content = "Regular markdown with [[wiki links]] and **bold**.";
        let result = transform_logseq_content(content);
        assert_eq!(result.content, content);
        assert!(result.transformations.is_empty());
    }

    #[test]
    fn test_multiple_transformations() {
        let content = "{{query something}}\n{{embed [[Page]]}}\n{{cloze answer}}";
        let result = transform_logseq_content(content);
        assert_eq!(
            result.content,
            "<!-- Logseq query removed -->\n[[Page]]\nanswer"
        );
        assert_eq!(result.transformations.len(), 3);
    }

    #[test]
    fn test_preserves_regular_content() {
        let content = "# Heading\n- List item\n- [[Link]] to page\n\nParagraph with **bold** and *italic*.";
        let result = transform_logseq_content(content);
        assert_eq!(result.content, content);
        assert!(result.transformations.is_empty());
    }

    #[test]
    fn test_transform_org_mode_query_with_crlf() {
        // Windows-style CRLF line endings
        let content = "Some text\r\n#+BEGIN_QUERY\r\n{:title \"Test\"}\r\n#+END_QUERY\r\nMore text";
        let result = transform_logseq_content(content);
        assert!(
            result.content.contains("<!-- Logseq query removed -->"),
            "Failed to remove query with CRLF. Result: {:?}",
            result.content
        );
    }

    #[test]
    fn test_transform_org_mode_query_no_newline_after_begin() {
        // Content starts immediately after BEGIN_QUERY (with just space)
        let content = "Some text\n#+BEGIN_QUERY {
:title \"Test\"
}
#+END_QUERY
More text";
        let result = transform_logseq_content(content);
        assert!(
            result.content.contains("<!-- Logseq query removed -->"),
            "Failed to remove query without newline. Result: {:?}",
            result.content
        );
    }

    #[test]
    fn test_transform_org_mode_query_at_file_start() {
        // Query block at the very start of file
        let content = "#+BEGIN_QUERY
{:title \"Test\"}
#+END_QUERY
More text";
        let result = transform_logseq_content(content);
        assert_eq!(
            result.content,
            "<!-- Logseq query removed -->\nMore text"
        );
    }
}
