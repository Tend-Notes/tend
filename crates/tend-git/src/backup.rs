// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Git backup manager
//!
//! Handles scheduled backups with garden locking.
//! For MVP, we use shell-out to git command for simplicity.
//! Can be replaced with gitoxide later for pure-Rust solution.

use std::path::{Path, PathBuf};
use std::process::Command;

use chrono::Utc;
use tracing::{debug, info, warn};

use crate::error::GitError;

/// Result of a backup operation
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub success: bool,
    pub commit_sha: Option<String>,
    pub message: String,
    pub timestamp: chrono::DateTime<Utc>,
}

/// Git status information
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    pub has_changes: bool,
    pub branch: Option<String>,
    pub remote: Option<String>,
    /// Whether the local branch has an upstream tracking branch configured
    pub has_upstream: bool,
    pub ahead: u32,
    pub behind: u32,
    /// List of changed files (path and status)
    pub changed_files: Vec<ChangedFile>,
}

/// A file with pending changes
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub status: FileStatus,
}

/// Status of a changed file
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
}

/// A commit in the history
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub sha: String,
    pub short_sha: String,
    pub message: String,
    pub author: String,
    pub timestamp: chrono::DateTime<Utc>,
    /// Files changed in this commit
    pub files_changed: u32,
}

/// Diff information for a commit
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDiff {
    pub sha: String,
    pub message: String,
    pub timestamp: chrono::DateTime<Utc>,
    /// List of file diffs
    pub files: Vec<FileDiff>,
}

/// Diff for a single file
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub status: FileStatus,
    /// The unified diff content
    pub diff: String,
}

/// Manages Git backup operations
#[derive(Clone)]
pub struct BackupManager {
    repo_path: PathBuf,
    auto_push: bool,
}

impl BackupManager {
    /// Create a new backup manager for the given repository path
    pub fn new(repo_path: impl AsRef<Path>, auto_push: bool) -> Self {
        Self {
            repo_path: repo_path.as_ref().to_path_buf(),
            auto_push,
        }
    }

    /// Check if the path is a Git repository
    pub fn is_git_repo(&self) -> bool {
        self.repo_path.join(".git").exists()
    }

    /// Initialize a Git repository if it doesn't exist
    pub fn init_repo(&self) -> Result<(), GitError> {
        if self.is_git_repo() {
            debug!("Git repository already exists");
            return Ok(());
        }

        info!("Initializing Git repository at: {}", self.repo_path.display());

        let output = Command::new("git")
            .args(["init"])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::OperationFailed(e.to_string()))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitError::OperationFailed(stderr.to_string()));
        }

        // Never materialize symlinks when checking out / pulling. A remote garden
        // (imported or pulled) could otherwise commit a page as a symlink to a
        // file outside the garden; with core.symlinks=false git writes the link
        // as a regular text file instead. Defense in depth with the storage
        // layer's symlink refusal (tend-storage::fs::ensure_within_root).
        Command::new("git")
            .args(["config", "core.symlinks", "false"])
            .current_dir(&self.repo_path)
            .output()
            .ok();

        // Configure default user if not set (needed for commits in sandboxed environments)
        let check_user = Command::new("git")
            .args(["config", "user.name"])
            .current_dir(&self.repo_path)
            .output();

        if check_user.map(|o| o.stdout.is_empty()).unwrap_or(true) {
            Command::new("git")
                .args(["config", "user.name", "Tend"])
                .current_dir(&self.repo_path)
                .output()
                .ok();
            Command::new("git")
                .args(["config", "user.email", "tend@localhost"])
                .current_dir(&self.repo_path)
                .output()
                .ok();
        }

        // Ensure .gitignore ignores all of .tend/ (see ensure_gitignore).
        self.ensure_gitignore()?;

        Ok(())
    }

    /// Ensure `.gitignore` ignores ALL of `.tend/`, and untrack any `.tend/`
    /// files a previous (narrow) ignore let get committed.
    ///
    /// `.tend/` is rebuildable local index state, not source of truth. The old
    /// ignore only listed `.tend/search_index/`, so the link index
    /// (`.tend/link_index/links.json` — plaintext wikilink/tag names) and the
    /// block DB (`.tend/blocks.db`) were committed and pushed to the remote. This
    /// runs idempotently on init and on every backup/commit so existing repos are
    /// migrated. It does NOT rewrite already-pushed history (owner's call).
    fn ensure_gitignore(&self) -> Result<(), GitError> {
        let gitignore_path = self.repo_path.join(".gitignore");
        let existing = std::fs::read_to_string(&gitignore_path).ok();
        let ignores_all_tend = existing
            .as_deref()
            .map(|c| c.lines().any(|l| l.trim() == ".tend/"))
            .unwrap_or(false);
        if ignores_all_tend {
            return Ok(());
        }

        let content = match existing {
            Some(existing) => {
                // Broaden a narrow `.tend/search_index/` ignore, else append.
                let mut out = String::new();
                let mut replaced = false;
                for line in existing.lines() {
                    if line.trim() == ".tend/search_index/" {
                        out.push_str(".tend/\n");
                        replaced = true;
                    } else {
                        out.push_str(line);
                        out.push('\n');
                    }
                }
                if !replaced {
                    out.push_str(".tend/\n");
                }
                out
            }
            None => "# Tend internal files\n.tend/\n*.tmp\n".to_string(),
        };
        std::fs::write(&gitignore_path, content)?;

        // Untrack any .tend/ files a prior narrow ignore let slip in (keeps them
        // on disk; not history scrubbing — old commits are unchanged).
        if self.is_git_repo() {
            let _ = Command::new("git")
                .args(["rm", "-r", "--cached", "--ignore-unmatch", ".tend"])
                .current_dir(&self.repo_path)
                .output();
        }
        info!("Ensured .gitignore ignores all of .tend/ (was leaking link/block index metadata)");
        Ok(())
    }

    /// Get the current Git status
    pub fn status(&self) -> Result<GitStatus, GitError> {
        if !self.is_git_repo() {
            return Ok(GitStatus {
                is_repo: false,
                has_changes: false,
                branch: None,
                remote: None,
                has_upstream: false,
                ahead: 0,
                behind: 0,
                changed_files: vec![],
            });
        }

        // Check for changes with porcelain format
        let status_output = Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::OperationFailed(e.to_string()))?;

        let status_str = String::from_utf8_lossy(&status_output.stdout);
        let changed_files = self.parse_porcelain_status(&status_str);
        let has_changes = !changed_files.is_empty();

        // Get current branch
        let branch_output = Command::new("git")
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::OperationFailed(e.to_string()))?;

        let branch = if branch_output.status.success() {
            Some(String::from_utf8_lossy(&branch_output.stdout).trim().to_string())
        } else {
            None
        };

        // Get remote
        let remote_output = Command::new("git")
            .args(["remote", "get-url", "origin"])
            .current_dir(&self.repo_path)
            .output();

        let remote = remote_output.ok().and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        });

        // Calculate ahead/behind if we have a remote and upstream tracking
        let (has_upstream, ahead, behind) = if remote.is_some() {
            match self.get_ahead_behind(&branch) {
                Some((a, b)) => (true, a, b),
                None => (false, 0, 0),
            }
        } else {
            (false, 0, 0)
        };

        Ok(GitStatus {
            is_repo: true,
            has_changes,
            branch,
            remote,
            has_upstream,
            ahead,
            behind,
            changed_files,
        })
    }

    /// Get ahead/behind counts relative to the upstream tracking branch
    fn get_ahead_behind(&self, branch: &Option<String>) -> Option<(u32, u32)> {
        let branch_name = branch.as_ref()?;

        // Get the upstream tracking branch
        let upstream_output = Command::new("git")
            .args(["rev-parse", "--abbrev-ref", &format!("{}@{{upstream}}", branch_name)])
            .current_dir(&self.repo_path)
            .output()
            .ok()?;

        if !upstream_output.status.success() {
            // No upstream configured
            return None;
        }

        // Get ahead/behind counts using rev-list
        let output = Command::new("git")
            .args([
                "rev-list",
                "--left-right",
                "--count",
                &format!("{}...{}@{{upstream}}", branch_name, branch_name),
            ])
            .current_dir(&self.repo_path)
            .output()
            .ok()?;

        if !output.status.success() {
            return None;
        }

        let counts = String::from_utf8_lossy(&output.stdout);
        let parts: Vec<&str> = counts.trim().split('\t').collect();
        if parts.len() == 2 {
            let ahead = parts[0].parse().unwrap_or(0);
            let behind = parts[1].parse().unwrap_or(0);
            Some((ahead, behind))
        } else {
            None
        }
    }

    /// Parse git status --porcelain output into ChangedFile list
    fn parse_porcelain_status(&self, output: &str) -> Vec<ChangedFile> {
        output
            .lines()
            .filter_map(|line| {
                if line.len() < 4 {
                    return None;
                }
                let status_code = &line[0..2];
                let path = line[3..].to_string();

                let status = match status_code {
                    "A " | " A" => FileStatus::Added,
                    "M " | " M" | "MM" => FileStatus::Modified,
                    "D " | " D" => FileStatus::Deleted,
                    "R " => FileStatus::Renamed,
                    "??" => FileStatus::Untracked,
                    _ => FileStatus::Modified, // Default for other cases
                };

                Some(ChangedFile { path, status })
            })
            .collect()
    }

    /// Get commit history, optionally filtered by file path
    pub fn history(&self, limit: Option<u32>, path_filter: Option<&str>) -> Result<Vec<CommitInfo>, GitError> {
        if !self.is_git_repo() {
            return Ok(vec![]);
        }

        let limit_str = limit.unwrap_or(50).to_string();

        // A marker prefixes each commit header so we can tell header lines from
        // the `--name-only` file lists that follow them.
        const MARKER: &str = "@@COMMIT@@";

        // Single process: `git log --name-only` yields both the commit metadata
        // and its changed-file list, so we count files without a `diff-tree`
        // subprocess per commit (previously 1 + N processes per history call).
        let mut args = vec![
            "log".to_string(),
            format!("-{}", limit_str),
            format!("--format={}%H|%h|%an|%aI|%s", MARKER),
            "--name-only".to_string(),
        ];

        // Add path filter if provided (git log -- <path>)
        if let Some(path) = path_filter {
            args.push("--".to_string());
            args.push(path.to_string());
        }

        let output = Command::new("git")
            .args(&args)
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::OperationFailed(e.to_string()))?;

        if !output.status.success() {
            // Might be an empty repo with no commits
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("does not have any commits") {
                return Ok(vec![]);
            }
            return Err(GitError::OperationFailed(stderr.to_string()));
        }

        let log_str = String::from_utf8_lossy(&output.stdout);
        let mut commits: Vec<CommitInfo> = Vec::new();
        let mut files_changed: u32 = 0;

        for line in log_str.lines() {
            if let Some(header) = line.strip_prefix(MARKER) {
                // Attribute the files counted so far to the previous commit.
                if let Some(last) = commits.last_mut() {
                    last.files_changed = files_changed;
                }
                files_changed = 0;

                let parts: Vec<&str> = header.splitn(5, '|').collect();
                if parts.len() < 5 {
                    continue;
                }
                let timestamp = chrono::DateTime::parse_from_rfc3339(parts[3])
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now());
                commits.push(CommitInfo {
                    sha: parts[0].to_string(),
                    short_sha: parts[1].to_string(),
                    message: parts[4].to_string(),
                    author: parts[2].to_string(),
                    timestamp,
                    files_changed: 0,
                });
            } else if !line.trim().is_empty() {
                // A changed-file line for the current commit.
                files_changed += 1;
            }
        }
        // Attribute the trailing file count to the final commit.
        if let Some(last) = commits.last_mut() {
            last.files_changed = files_changed;
        }

        Ok(commits)
    }

    /// Get diff for a specific commit, optionally filtered to a specific file
    pub fn diff(&self, commit_sha: &str, file_path: Option<&str>) -> Result<CommitDiff, GitError> {
        validate_commit_sha(commit_sha)?;
        if !self.is_git_repo() {
            return Err(GitError::RepositoryError("Not a git repository".to_string()));
        }

        // Get commit info
        let info_output = Command::new("git")
            .args(["log", "-1", "--format=%s|%aI", commit_sha])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::OperationFailed(e.to_string()))?;

        if !info_output.status.success() {
            return Err(GitError::OperationFailed("Commit not found".to_string()));
        }

        let info_str = String::from_utf8_lossy(&info_output.stdout);
        let info_parts: Vec<&str> = info_str.trim().splitn(2, '|').collect();
        let message = info_parts.first().unwrap_or(&"").to_string();
        let timestamp = info_parts
            .get(1)
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(Utc::now);

        // Get the diff (compare with parent, or show all for root commit)
        // If file_path is provided, only show diff for that file
        let mut args = vec!["diff-tree", "-p", "--root", commit_sha];
        if let Some(path) = file_path {
            args.push("--");
            args.push(path);
        }

        let diff_output = Command::new("git")
            .args(&args)
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::OperationFailed(e.to_string()))?;

        let diff_str = String::from_utf8_lossy(&diff_output.stdout);
        let files = self.parse_diff_output(&diff_str);

        Ok(CommitDiff {
            sha: commit_sha.to_string(),
            message,
            timestamp,
            files,
        })
    }

    /// Parse git diff output into FileDiff structs
    fn parse_diff_output(&self, diff_output: &str) -> Vec<FileDiff> {
        let mut files = Vec::new();
        let mut current_file: Option<String> = None;
        let mut current_diff = String::new();
        let mut current_status = FileStatus::Modified;

        for line in diff_output.lines() {
            if line.starts_with("diff --git") {
                // Save previous file if exists
                if let Some(path) = current_file.take() {
                    files.push(FileDiff {
                        path,
                        status: current_status.clone(),
                        diff: current_diff.clone(),
                    });
                }

                // Parse new file path
                // Format: diff --git a/path b/path
                if let Some(b_path) = line.split(" b/").nth(1) {
                    current_file = Some(b_path.to_string());
                }
                current_diff = String::new();
                current_status = FileStatus::Modified;
            } else if line.starts_with("new file") {
                current_status = FileStatus::Added;
            } else if line.starts_with("deleted file") {
                current_status = FileStatus::Deleted;
            } else if line.starts_with("rename") {
                current_status = FileStatus::Renamed;
            } else if current_file.is_some() {
                // Accumulate diff lines (skip the first commit hash line)
                if !line.is_empty() && !line.chars().all(|c| c.is_ascii_hexdigit()) {
                    current_diff.push_str(line);
                    current_diff.push('\n');
                }
            }
        }

        // Save last file
        if let Some(path) = current_file {
            files.push(FileDiff {
                path,
                status: current_status,
                diff: current_diff,
            });
        }

        files
    }

    /// Run a backup (add all, commit, optionally push)
    pub fn backup(&self) -> Result<BackupResult, GitError> {
        if !self.is_git_repo() {
            self.init_repo()?;
        }
        // Migrate existing repos to the broad .tend/ ignore before staging.
        self.ensure_gitignore()?;

        let timestamp = Utc::now();

        // Check for changes first
        let status = self.status()?;
        if !status.has_changes {
            return Ok(BackupResult {
                success: true,
                commit_sha: None,
                message: "No changes to commit".to_string(),
                timestamp,
            });
        }

        info!("Running backup...");

        // Stage all changes
        let add_output = Command::new("git")
            .args(["add", "-A"])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::OperationFailed(e.to_string()))?;

        if !add_output.status.success() {
            let stderr = String::from_utf8_lossy(&add_output.stderr);
            return Err(GitError::OperationFailed(format!("git add failed: {}", stderr)));
        }

        // Commit
        let commit_msg = format!("Auto-backup: {}", timestamp.format("%Y-%m-%d %H:%M:%S UTC"));
        let commit_output = Command::new("git")
            .args(["commit", "-m", &commit_msg])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::OperationFailed(e.to_string()))?;

        if !commit_output.status.success() {
            let stderr = String::from_utf8_lossy(&commit_output.stderr);
            // Check if it's just "nothing to commit"
            if stderr.contains("nothing to commit") {
                return Ok(BackupResult {
                    success: true,
                    commit_sha: None,
                    message: "No changes to commit".to_string(),
                    timestamp,
                });
            }
            return Err(GitError::OperationFailed(format!("git commit failed: {}", stderr)));
        }

        // Get the commit SHA
        let sha_output = Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::OperationFailed(e.to_string()))?;

        let commit_sha = if sha_output.status.success() {
            Some(String::from_utf8_lossy(&sha_output.stdout).trim().to_string())
        } else {
            None
        };

        // Push if configured and remote exists
        if self.auto_push && status.remote.is_some() {
            info!("Pushing to remote...");
            let push_output = Command::new("git")
                .args(["push"])
                .env("GIT_ALLOW_PROTOCOL", "https:http:ssh")
                .current_dir(&self.repo_path)
                .output();

            match push_output {
                Ok(output) if output.status.success() => {
                    info!("Pushed to remote successfully");
                }
                Ok(output) => {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    warn!("Push failed: {}", stderr);
                }
                Err(e) => {
                    warn!("Push failed: {}", e);
                }
            }
        }

        info!("Backup completed: {:?}", commit_sha);

        Ok(BackupResult {
            success: true,
            commit_sha,
            message: commit_msg,
            timestamp,
        })
    }

    /// Commit with a custom message (for manual commits via command palette)
    pub fn commit(&self, message: Option<&str>) -> Result<BackupResult, GitError> {
        if !self.is_git_repo() {
            self.init_repo()?;
        }
        // Migrate existing repos to the broad .tend/ ignore before staging.
        self.ensure_gitignore()?;

        let timestamp = Utc::now();

        // Check for changes first
        let status = self.status()?;
        if !status.has_changes {
            return Ok(BackupResult {
                success: true,
                commit_sha: None,
                message: "No changes to commit".to_string(),
                timestamp,
            });
        }

        info!("Creating commit...");

        // Stage all changes
        let add_output = Command::new("git")
            .args(["add", "-A"])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::OperationFailed(e.to_string()))?;

        if !add_output.status.success() {
            let stderr = String::from_utf8_lossy(&add_output.stderr);
            return Err(GitError::OperationFailed(format!("git add failed: {}", stderr)));
        }

        // Use custom message or generate one
        let commit_msg = message
            .map(|m| m.to_string())
            .unwrap_or_else(|| format!("Update: {}", timestamp.format("%Y-%m-%d %H:%M:%S UTC")));

        let commit_output = Command::new("git")
            .args(["commit", "-m", &commit_msg])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::OperationFailed(e.to_string()))?;

        if !commit_output.status.success() {
            let stderr = String::from_utf8_lossy(&commit_output.stderr);
            if stderr.contains("nothing to commit") {
                return Ok(BackupResult {
                    success: true,
                    commit_sha: None,
                    message: "No changes to commit".to_string(),
                    timestamp,
                });
            }
            return Err(GitError::OperationFailed(format!("git commit failed: {}", stderr)));
        }

        // Get the commit SHA
        let sha_output = Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::OperationFailed(e.to_string()))?;

        let commit_sha = if sha_output.status.success() {
            Some(String::from_utf8_lossy(&sha_output.stdout).trim().to_string())
        } else {
            None
        };

        info!("Commit completed: {:?}", commit_sha);

        Ok(BackupResult {
            success: true,
            commit_sha,
            message: commit_msg,
            timestamp,
        })
    }

    /// Restore to a specific commit, optionally for a single file only
    /// If file_path is provided, only that file is restored; otherwise all files are restored.
    pub fn restore(&self, commit_sha: &str, file_path: Option<&str>) -> Result<(), GitError> {
        validate_commit_sha(commit_sha)?;
        if !self.is_git_repo() {
            return Err(GitError::RepositoryError("Not a git repository".to_string()));
        }

        let target_desc = if let Some(path) = file_path {
            format!("{} from {}", path, &commit_sha[..7])
        } else {
            format!("all files to {}", &commit_sha[..7])
        };
        info!("Restoring {}", target_desc);

        // First, commit any current changes so we don't lose them
        let status = self.status()?;
        if status.has_changes {
            self.commit(Some(&format!("Auto-save before restore to {}", &commit_sha[..7])))?;
        }

        // Checkout the file(s) from that commit (but don't change HEAD)
        let mut args = vec!["checkout", commit_sha, "--"];
        if let Some(path) = file_path {
            args.push(path);
        } else {
            args.push(".");
        }

        let output = Command::new("git")
            .args(&args)
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::OperationFailed(e.to_string()))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitError::OperationFailed(format!("Restore failed: {}", stderr)));
        }

        // Auto-commit the restore
        let commit_msg = if let Some(path) = file_path {
            format!("Restored {} to {}", path, &commit_sha[..7])
        } else {
            format!("Restored to {}", &commit_sha[..7])
        };
        self.commit(Some(&commit_msg))?;

        info!("Restore completed");
        Ok(())
    }

    /// Push to remote repository
    pub fn push(&self) -> Result<PushResult, GitError> {
        if !self.is_git_repo() {
            return Err(GitError::RepositoryError("Not a git repository".to_string()));
        }

        let status = self.status()?;
        if status.remote.is_none() {
            return Err(GitError::NoRemote);
        }

        info!("Pushing to remote...");

        let output = Command::new("git")
            .args(["push"])
            .env("GIT_ALLOW_PROTOCOL", "https:http:ssh")
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::OperationFailed(e.to_string()))?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);

            // Git push output often goes to stderr even on success
            let message = if stderr.contains("Everything up-to-date") {
                "Everything up-to-date".to_string()
            } else {
                format!("Pushed to {}", status.remote.unwrap_or_default())
            };

            info!("Push successful: {}", message);
            Ok(PushResult {
                success: true,
                message,
                details: if stdout.is_empty() { stderr.to_string() } else { stdout.to_string() },
            })
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(GitError::OperationFailed(format!("Push failed: {}", stderr)))
        }
    }

    /// Pull from remote repository
    pub fn pull(&self) -> Result<PushResult, GitError> {
        if !self.is_git_repo() {
            return Err(GitError::RepositoryError("Not a git repository".to_string()));
        }

        let status = self.status()?;
        if status.remote.is_none() {
            return Err(GitError::NoRemote);
        }

        info!("Pulling from remote...");

        let output = Command::new("git")
            .args(["pull", "--rebase"])
            .env("GIT_ALLOW_PROTOCOL", "https:http:ssh")
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::OperationFailed(e.to_string()))?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);

            let message = if stdout.contains("Already up to date") {
                "Already up to date".to_string()
            } else {
                "Pulled latest changes".to_string()
            };

            info!("Pull successful: {}", message);
            Ok(PushResult {
                success: true,
                message,
                details: stdout.to_string(),
            })
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(GitError::OperationFailed(format!("Pull failed: {}", stderr)))
        }
    }

    /// Set or update the remote repository URL
    pub fn set_remote(&self, url: &str) -> Result<RemoteResult, GitError> {
        // Crate-boundary defense: never store an unvalidated remote URL.
        validate_remote_url(url)?;

        if !self.is_git_repo() {
            return Err(GitError::RepositoryError("Not a git repository".to_string()));
        }

        info!("Setting remote to: {}", url);

        // Check if origin remote already exists
        let check_output = Command::new("git")
            .args(["remote", "get-url", "origin"])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::OperationFailed(e.to_string()))?;

        let args = if check_output.status.success() {
            // Remote exists, update it
            vec!["remote", "set-url", "origin", url]
        } else {
            // Remote doesn't exist, add it
            vec!["remote", "add", "origin", url]
        };

        let output = Command::new("git")
            .args(&args)
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::OperationFailed(e.to_string()))?;

        if output.status.success() {
            info!("Remote set successfully");
            Ok(RemoteResult {
                success: true,
                url: url.to_string(),
                message: "Remote configured".to_string(),
                verified: false,
            })
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(GitError::OperationFailed(format!("Failed to set remote: {}", stderr)))
        }
    }

    /// Remove the remote repository
    pub fn remove_remote(&self) -> Result<(), GitError> {
        if !self.is_git_repo() {
            return Err(GitError::RepositoryError("Not a git repository".to_string()));
        }

        info!("Removing remote origin");

        let output = Command::new("git")
            .args(["remote", "remove", "origin"])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::OperationFailed(e.to_string()))?;

        if output.status.success() {
            info!("Remote removed successfully");
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // If remote doesn't exist, that's fine
            if stderr.contains("No such remote") {
                Ok(())
            } else {
                Err(GitError::OperationFailed(format!("Failed to remove remote: {}", stderr)))
            }
        }
    }

    /// Test connection to the remote repository
    pub fn test_remote(&self) -> Result<RemoteResult, GitError> {
        if !self.is_git_repo() {
            return Err(GitError::RepositoryError("Not a git repository".to_string()));
        }

        let status = self.status()?;
        let url = status.remote.ok_or(GitError::NoRemote)?;

        info!("Testing remote connection: {}", url);

        // Use git ls-remote to test connection without fetching
        // Note: Don't use --exit-code as it returns 2 for empty repos (which is still a valid connection)
        let output = Command::new("git")
            .args(["ls-remote", "origin"])
            .env("GIT_ALLOW_PROTOCOL", "https:http:ssh")
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::OperationFailed(e.to_string()))?;

        // Exit code 0 means connection succeeded (even if repo is empty)
        if output.status.success() {
            info!("Remote connection verified");
            Ok(RemoteResult {
                success: true,
                url,
                message: "Connection verified".to_string(),
                verified: true,
            })
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr_trimmed = stderr.trim();
            let stdout_trimmed = stdout.trim();

            // Log full output for debugging
            info!(
                "Remote test failed. exit={:?} stderr='{}' stdout='{}'",
                output.status.code(),
                stderr_trimmed,
                stdout_trimmed
            );

            // Check both stderr and stdout for error messages
            let combined = format!("{} {}", stderr, stdout);

            let message = if combined.contains("Permission denied") || combined.contains("publickey") {
                "Authentication failed - check SSH keys or credentials".to_string()
            } else if combined.contains("Could not resolve host") || combined.contains("Connection refused") {
                "Cannot reach remote server - check URL".to_string()
            } else if combined.contains("Repository not found") || combined.contains("does not exist") {
                "Repository not found - check URL".to_string()
            } else if combined.contains("Host key verification failed") {
                "Host key verification failed - add host to known_hosts".to_string()
            } else if combined.contains("fatal:") {
                // Extract the fatal error message from either stream
                combined
                    .lines()
                    .find(|l| l.contains("fatal:"))
                    .map(|l| l.trim_start_matches("fatal:").trim().to_string())
                    .unwrap_or_else(|| "Connection failed".to_string())
            } else if !stderr_trimmed.is_empty() {
                // Return first non-empty line from stderr
                stderr_trimmed
                    .lines()
                    .find(|l| !l.trim().is_empty())
                    .unwrap_or("Connection failed")
                    .to_string()
            } else if !stdout_trimmed.is_empty() {
                // Try stdout if stderr was empty
                stdout_trimmed
                    .lines()
                    .find(|l| !l.trim().is_empty())
                    .unwrap_or("Connection failed")
                    .to_string()
            } else {
                // Both empty - check exit code
                format!(
                    "Connection failed (exit code {})",
                    output.status.code().map(|c| c.to_string()).unwrap_or_else(|| "unknown".to_string())
                )
            };

            Ok(RemoteResult {
                success: false,
                url,
                message,
                verified: false,
            })
        }
    }

    /// Check if the remote repository contains a Tend garden
    /// Returns garden info if found, including the garden name from .garden-meta
    pub fn check_remote_has_garden(&self) -> Result<RemoteGardenInfo, GitError> {
        if !self.is_git_repo() {
            return Err(GitError::RepositoryError("Not a git repository".to_string()));
        }

        let status = self.status()?;
        if status.remote.is_none() {
            return Err(GitError::NoRemote);
        }

        // Fetch from remote first to get latest refs
        let fetch_output = Command::new("git")
            .args(["fetch", "origin"])
            .env("GIT_ALLOW_PROTOCOL", "https:http:ssh")
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::OperationFailed(e.to_string()))?;

        if !fetch_output.status.success() {
            // Can't fetch, so can't check
            return Ok(RemoteGardenInfo {
                found: false,
                name: None,
            });
        }

        // Determine the remote's default branch
        let remote_branch = self.detect_remote_branch()?;

        // Try to read .garden-meta from the remote branch
        let show_output = Command::new("git")
            .args(["show", &format!("origin/{}:.garden-meta", remote_branch)])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::OperationFailed(e.to_string()))?;

        if !show_output.status.success() {
            // No .garden-meta file found
            return Ok(RemoteGardenInfo {
                found: false,
                name: None,
            });
        }

        // Parse the garden meta file
        let content = String::from_utf8_lossy(&show_output.stdout);
        if let Ok(meta) = serde_json::from_str::<serde_json::Value>(&content) {
            // Verify it's a tend-garden
            if meta.get("type").and_then(|t| t.as_str()) == Some("tend-garden") {
                let name = meta.get("name").and_then(|n| n.as_str()).map(String::from);
                return Ok(RemoteGardenInfo { found: true, name });
            }
        }

        // File exists but isn't valid garden meta
        Ok(RemoteGardenInfo {
            found: false,
            name: None,
        })
    }

    /// Detect the remote's default branch (main, master, or trunk)
    fn detect_remote_branch(&self) -> Result<String, GitError> {
        // Try symbolic-ref first
        let remote_head = Command::new("git")
            .args(["symbolic-ref", "refs/remotes/origin/HEAD"])
            .current_dir(&self.repo_path)
            .output();

        if let Ok(output) = remote_head {
            if output.status.success() {
                let branch = String::from_utf8_lossy(&output.stdout)
                    .trim()
                    .strip_prefix("refs/remotes/origin/")
                    .unwrap_or("main")
                    .to_string();
                return Ok(branch);
            }
        }

        // Try common branch names
        for branch in &["main", "master", "trunk"] {
            let check = Command::new("git")
                .args(["rev-parse", "--verify", &format!("origin/{}", branch)])
                .current_dir(&self.repo_path)
                .output();

            if let Ok(output) = check {
                if output.status.success() {
                    return Ok(branch.to_string());
                }
            }
        }

        Ok("main".to_string())
    }

    /// Import a garden from the remote repository
    /// This fetches and merges/resets to match the remote
    pub fn import_remote_garden(&self) -> Result<ImportResult, GitError> {
        if !self.is_git_repo() {
            return Err(GitError::RepositoryError("Not a git repository".to_string()));
        }

        // Defensively disable symlink materialization for repos created before
        // init_repo started setting this (the checkout below would otherwise
        // honor symlink blobs committed by the remote). See init_repo.
        Command::new("git")
            .args(["config", "core.symlinks", "false"])
            .current_dir(&self.repo_path)
            .output()
            .ok();

        let status = self.status()?;
        let remote_url = status.remote.clone().ok_or(GitError::NoRemote)?;

        info!("Importing garden from remote: {}", remote_url);

        // Fetch from remote
        let fetch_output = Command::new("git")
            .args(["fetch", "origin"])
            .env("GIT_ALLOW_PROTOCOL", "https:http:ssh")
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::OperationFailed(e.to_string()))?;

        if !fetch_output.status.success() {
            let stderr = String::from_utf8_lossy(&fetch_output.stderr);
            return Err(GitError::OperationFailed(format!("Fetch failed: {}", stderr)));
        }

        // Check if we have a local branch
        let branch_output = Command::new("git")
            .args(["branch", "--show-current"])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::OperationFailed(e.to_string()))?;

        let current_branch = String::from_utf8_lossy(&branch_output.stdout).trim().to_string();

        // Determine the remote's default branch
        let remote_head = Command::new("git")
            .args(["symbolic-ref", "refs/remotes/origin/HEAD"])
            .current_dir(&self.repo_path)
            .output();

        let remote_branch = if let Ok(output) = remote_head {
            if output.status.success() {
                String::from_utf8_lossy(&output.stdout)
                    .trim()
                    .strip_prefix("refs/remotes/origin/")
                    .unwrap_or("main")
                    .to_string()
            } else {
                // Try to detect main vs master
                let check_main = Command::new("git")
                    .args(["rev-parse", "--verify", "origin/main"])
                    .current_dir(&self.repo_path)
                    .output();
                if check_main.map(|o| o.status.success()).unwrap_or(false) {
                    "main".to_string()
                } else {
                    "master".to_string()
                }
            }
        } else {
            "main".to_string()
        };

        info!("Remote branch: {}, local branch: {:?}", remote_branch, current_branch);

        // If local repo is empty (no commits), we can just checkout the remote branch
        let has_commits = Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&self.repo_path)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if !has_commits {
            // No local commits, checkout remote branch directly
            let checkout_output = Command::new("git")
                .args(["checkout", "-B", &remote_branch, &format!("origin/{}", remote_branch)])
                .current_dir(&self.repo_path)
                .output()
                .map_err(|e| GitError::OperationFailed(e.to_string()))?;

            if !checkout_output.status.success() {
                let stderr = String::from_utf8_lossy(&checkout_output.stderr);
                return Err(GitError::OperationFailed(format!("Checkout failed: {}", stderr)));
            }

            // Set up tracking
            let _ = Command::new("git")
                .args(["branch", "--set-upstream-to", &format!("origin/{}", remote_branch)])
                .current_dir(&self.repo_path)
                .output();

            info!("Imported garden from remote (fresh checkout)");
            return Ok(ImportResult {
                success: true,
                message: format!("Imported garden from {}", remote_url),
                files_changed: 0, // We don't count on fresh checkout
            });
        }

        // User explicitly requested import - reset to remote branch
        // This discards any local commits and replaces with remote content
        //
        // The user clicked "Import Garden" after seeing the remote has a garden,
        // so they want the remote content to replace local content.
        info!("Importing garden: resetting to remote branch {}", remote_branch);

        // First, stash any uncommitted changes (in case there are working tree changes)
        let _ = Command::new("git")
            .args(["stash", "--include-untracked"])
            .current_dir(&self.repo_path)
            .output();

        // Checkout the remote branch, creating it if needed, discarding local commits
        let checkout_output = Command::new("git")
            .args([
                "checkout",
                "-B",
                &remote_branch,
                &format!("origin/{}", remote_branch),
            ])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::OperationFailed(e.to_string()))?;

        if !checkout_output.status.success() {
            let stderr = String::from_utf8_lossy(&checkout_output.stderr);
            return Err(GitError::OperationFailed(format!(
                "Failed to checkout remote branch: {}",
                stderr
            )));
        }

        // Set up tracking
        let _ = Command::new("git")
            .args([
                "branch",
                "--set-upstream-to",
                &format!("origin/{}", remote_branch),
            ])
            .current_dir(&self.repo_path)
            .output();

        // Drop the stash (we don't need the old uncommitted changes)
        let _ = Command::new("git")
            .args(["stash", "drop"])
            .current_dir(&self.repo_path)
            .output();

        info!("Imported garden from remote");
        Ok(ImportResult {
            success: true,
            message: format!("Imported garden from {}", remote_url),
            files_changed: 0,
        })
    }
}

/// Result of importing a remote garden
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub success: bool,
    pub message: String,
    pub files_changed: usize,
}

/// Information about a garden detected in a remote repository
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteGardenInfo {
    pub found: bool,
    pub name: Option<String>,
}

/// Result of setting or testing a remote
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteResult {
    pub success: bool,
    pub url: String,
    pub message: String,
    pub verified: bool,
}

/// Result of a push/pull operation
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushResult {
    pub success: bool,
    pub message: String,
    pub details: String,
}

/// Validate a git remote URL before it is stored or used.
///
/// Git honours remote-helper transports such as `ext::` and `fd::`, so a crafted
/// remote URL (e.g. `ext::sh -c '<cmd>'`) would run arbitrary shell commands on
/// the host during any later `push`/`pull`/`ls-remote`/`fetch`. We therefore
/// allow ONLY ordinary transport URLs (`https`/`http`/`ssh`) and scp-style
/// `[user@]host:path`, and reject everything else.
pub fn validate_remote_url(url: &str) -> Result<(), GitError> {
    let reject = |why: &str| -> Result<(), GitError> {
        Err(GitError::RepositoryError(format!("Rejected remote URL: {why}")))
    };

    if url.is_empty() {
        return reject("empty");
    }
    // A leading '-' would be parsed by git as a command-line option.
    if url.starts_with('-') {
        return reject("must not start with '-'");
    }
    // Real remote URLs never contain whitespace or control characters; rejecting
    // them also defeats `ext::sh -c '...'`-style payloads.
    if url.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return reject("contains whitespace or control characters");
    }

    let lower = url.to_ascii_lowercase();

    // Local-file transport is never a valid *remote*.
    if lower.starts_with("file://") {
        return reject("file:// is not allowed");
    }

    // Remote-helper transports use `scheme::…`. Any `::` in the segment before
    // the first '/' means a helper (ext::, fd::, …). Standard URLs (`https://`)
    // and scp-style (`git@host:path`) never have `::` there.
    let before_first_slash = url.split('/').next().unwrap_or(url);
    if before_first_slash.contains("::") {
        return reject("remote-helper transports are not allowed");
    }

    let is_transport_url =
        lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("ssh://");
    // scp-style: `[user@]host:path` — a ':' with a non-empty host that has no
    // '/' before it, and which is not a `scheme://` URL.
    let is_scp_style = !url.contains("://")
        && url
            .find(':')
            .map(|i| i > 0 && !url[..i].contains('/'))
            .unwrap_or(false);

    if !(is_transport_url || is_scp_style) {
        return reject("only https/http/ssh URLs or scp-style host:path are allowed");
    }

    Ok(())
}

/// Validate a git commit SHA before using it as a command argument.
///
/// A `-`-leading value would be parsed by git as an option (e.g.
/// `--output=/path` → arbitrary file write), and a value shorter than 7 bytes or
/// on a non-char boundary panics the `&sha[..7]` slices. Requiring 7–40 hex
/// characters removes both.
pub fn validate_commit_sha(sha: &str) -> Result<(), GitError> {
    if (7..=40).contains(&sha.len()) && sha.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(GitError::RepositoryError(format!(
            "Invalid commit SHA: {sha:?} (expected 7-40 hex characters)"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup() -> (TempDir, BackupManager) {
        let temp_dir = TempDir::new().unwrap();
        let bm = BackupManager::new(temp_dir.path(), false);
        (temp_dir, bm)
    }

    #[test]
    fn test_validate_commit_sha() {
        let too_long = "a".repeat(41);
        let non_hex_40 = "z".repeat(40);
        for bad in [
            "", "abc", "--output=/tmp/x", "-rf", "abc123!", "  abcdef1",
            too_long.as_str(), non_hex_40.as_str(),
        ] {
            assert!(validate_commit_sha(bad).is_err(), "expected rejection for {bad:?}");
        }
        for good in ["abcdef1", "0123456789abcdef0123456789abcdef01234567", "ABCDEF1234"] {
            assert!(validate_commit_sha(good).is_ok(), "expected acceptance for {good:?}");
        }
    }

    #[test]
    fn test_validate_remote_url() {
        // Malicious / disallowed transports and shapes are rejected.
        for bad in [
            "",
            "ext::sh -c 'id'",
            "ext::somehelper",
            "fd::17/foo",
            "file:///etc/passwd",
            "-oProxyCommand=id",
            "--upload-pack=id",
            "git://github.com/user/repo.git", // git:// not allowed
            "github.com/user/repo",           // schemeless, not scp-style
        ] {
            assert!(
                validate_remote_url(bad).is_err(),
                "expected rejection for {bad:?}"
            );
        }

        // Ordinary transport + scp-style URLs are accepted.
        for good in [
            "https://github.com/user/repo.git",
            "http://example.com/user/repo.git",
            "ssh://git@github.com:22/user/repo.git",
            "git@github.com:user/repo.git",
        ] {
            assert!(
                validate_remote_url(good).is_ok(),
                "expected acceptance for {good:?}"
            );
        }
    }

    #[test]
    fn test_init_repo() {
        let (temp_dir, bm) = setup();

        assert!(!bm.is_git_repo());
        bm.init_repo().unwrap();
        assert!(bm.is_git_repo());

        // Check .gitignore was created and ignores ALL of .tend/ (not just the
        // search index) so link/block index metadata is never pushed.
        let gitignore = std::fs::read_to_string(temp_dir.path().join(".gitignore")).unwrap();
        assert!(gitignore.lines().any(|l| l.trim() == ".tend/"), "gitignore: {gitignore:?}");
        assert!(!gitignore.contains(".tend/search_index/"));
    }

    #[test]
    fn test_ensure_gitignore_migrates_narrow_ignore() {
        let (temp_dir, bm) = setup();
        // Simulate an old repo with the narrow ignore.
        std::fs::write(
            temp_dir.path().join(".gitignore"),
            "# Tend internal files\n.tend/search_index/\n*.tmp\n",
        )
        .unwrap();
        bm.ensure_gitignore().unwrap();
        let gitignore = std::fs::read_to_string(temp_dir.path().join(".gitignore")).unwrap();
        assert!(gitignore.lines().any(|l| l.trim() == ".tend/"));
        assert!(!gitignore.contains(".tend/search_index/"));
        // *.tmp is preserved.
        assert!(gitignore.contains("*.tmp"));
    }

    #[test]
    fn test_status_not_repo() {
        let (_temp_dir, bm) = setup();

        let status = bm.status().unwrap();
        assert!(!status.is_repo);
    }

    #[test]
    fn test_status_empty_repo() {
        let (_temp_dir, bm) = setup();

        bm.init_repo().unwrap();
        let status = bm.status().unwrap();

        assert!(status.is_repo);
        // New repo with .gitignore has changes
        assert!(status.has_changes);
    }

    #[test]
    fn test_backup() {
        let (temp_dir, bm) = setup();

        // Create a test file
        std::fs::write(temp_dir.path().join("test.md"), "# Test\n").unwrap();

        let result = bm.backup().unwrap();
        assert!(result.success);
        assert!(result.commit_sha.is_some());
    }

    #[test]
    fn test_history_parses_commits_and_file_counts() {
        let (temp_dir, bm) = setup();

        // Commit 1: one new file.
        std::fs::write(temp_dir.path().join("a.md"), "# A\n").unwrap();
        bm.backup().unwrap();
        // Commit 2: two new files.
        std::fs::write(temp_dir.path().join("b.md"), "# B\n").unwrap();
        std::fs::write(temp_dir.path().join("c.md"), "# C\n").unwrap();
        bm.backup().unwrap();
        // Commit 3: modify one existing file.
        std::fs::write(temp_dir.path().join("a.md"), "# A edited\n").unwrap();
        bm.backup().unwrap();

        let history = bm.history(Some(10), None).unwrap();
        // 3 backups (the initial repo .gitignore may add a 4th commit).
        assert!(history.len() >= 3, "expected >=3 commits, got {}", history.len());

        // Newest first: the modify-one-file commit.
        assert_eq!(history[0].files_changed, 1, "modify commit changed 1 file");
        // The two-new-files commit changed at least 2.
        assert!(history[1].files_changed >= 2, "second commit changed >=2 files");
        // Metadata parsed.
        assert!(!history[0].sha.is_empty() && !history[0].message.is_empty());
    }
}
