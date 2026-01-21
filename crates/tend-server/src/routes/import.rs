// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Import API routes for importing from other tools (Logseq)

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tokio::fs;

use anyhow::Context;

use crate::error::AppError;
use crate::state::AppState;

/// Request to import a Logseq graph
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

/// Result of an import operation
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

/// Import a Logseq graph
pub async fn import_logseq(
    State(state): State<Arc<AppState>>,
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

    let garden = state.garden.read().await;
    let garden_path = garden.file_manager.root().to_path_buf();

    let mut pages_imported = 0;
    let mut journals_imported = 0;
    let mut skipped = 0;
    let mut warnings = Vec::new();
    let mut all_targets: HashSet<String> = HashSet::new();
    let mut all_links: Vec<(String, String)> = Vec::new();

    // Logseq journal date patterns
    // Logseq uses formats like: 2024_01_15.md, 2024-01-15.md, Jan 15th, 2024.md
    let journal_date_regex = Regex::new(r"^(\d{4})[-_](\d{2})[-_](\d{2})\.md$").unwrap();
    let journal_date_verbose = Regex::new(
        r"^([A-Za-z]{3}) (\d{1,2})(?:st|nd|rd|th)?, (\d{4})\.md$"
    ).unwrap();

    // Process pages directory
    let pages_dir = source_path.join("pages");
    if pages_dir.exists() {
        let mut entries = fs::read_dir(&pages_dir).await
            .context("Failed to read pages directory")?;
        while let Some(entry) = entries.next_entry().await
            .context("Failed to read directory entry")? {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }

            let file_name = path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default();

            // Logseq uses URL-encoded file names, decode them
            let page_name = urlencoding::decode(
                file_name.trim_end_matches(".md")
            ).unwrap_or_else(|_| file_name.trim_end_matches(".md").into())
            .to_string();

            all_targets.insert(page_name.clone());

            let dest_path = garden_path.join("pages").join(format!("{}.md", page_name));

            // Check if already exists
            if dest_path.exists() && !req.overwrite {
                skipped += 1;
                continue;
            }

            // Read content and extract links
            let content = fs::read_to_string(&path).await
                .context(format!("Failed to read file: {}", path.display()))?;
            extract_wiki_links(&content, &file_name, &mut all_links);

            if !req.dry_run {
                // Ensure pages directory exists
                fs::create_dir_all(garden_path.join("pages")).await
                    .context("Failed to create pages directory")?;
                fs::write(&dest_path, &content).await
                    .context(format!("Failed to write file: {}", dest_path.display()))?;
            }

            pages_imported += 1;
        }
    }

    // Process journals directory
    let journals_dir = source_path.join("journals");
    if journals_dir.exists() {
        let mut entries = fs::read_dir(&journals_dir).await
            .context("Failed to read journals directory")?;
        while let Some(entry) = entries.next_entry().await
            .context("Failed to read directory entry")? {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }

            let file_name = path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default();

            // Convert Logseq date format to Tend format (YYYY-MM-DD.md)
            let dest_name = if let Some(caps) = journal_date_regex.captures(file_name) {
                // Already in YYYY-MM-DD or YYYY_MM_DD format
                format!("{}-{}-{}.md", &caps[1], &caps[2], &caps[3])
            } else if let Some(caps) = journal_date_verbose.captures(file_name) {
                // Verbose format like "Jan 15th, 2024.md"
                let month = match &caps[1].to_lowercase()[..3] {
                    "jan" => "01", "feb" => "02", "mar" => "03", "apr" => "04",
                    "may" => "05", "jun" => "06", "jul" => "07", "aug" => "08",
                    "sep" => "09", "oct" => "10", "nov" => "11", "dec" => "12",
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
            let content = fs::read_to_string(&path).await
                .context(format!("Failed to read file: {}", path.display()))?;
            extract_wiki_links(&content, &file_name, &mut all_links);

            if !req.dry_run {
                // Ensure journals directory exists
                fs::create_dir_all(garden_path.join("journals")).await
                    .context("Failed to create journals directory")?;
                fs::write(&dest_path, &content).await
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
