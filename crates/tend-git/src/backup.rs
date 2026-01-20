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

        // Create .gitignore
        let gitignore_path = self.repo_path.join(".gitignore");
        if !gitignore_path.exists() {
            std::fs::write(
                &gitignore_path,
                "# Tend internal files\n.tend/search_index/\n*.tmp\n",
            )?;
        }

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

        Ok(GitStatus {
            is_repo: true,
            has_changes,
            branch,
            remote,
            ahead: 0, // TODO: Calculate ahead/behind
            behind: 0,
            changed_files,
        })
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

        // Build args for git log
        let mut args = vec![
            "log".to_string(),
            format!("-{}", limit_str),
            "--format=%H|%h|%an|%aI|%s".to_string(),
        ];

        // Add path filter if provided (git log -- <path>)
        if let Some(path) = path_filter {
            args.push("--".to_string());
            args.push(path.to_string());
        }

        // Get log with custom format: sha|short_sha|author|timestamp|message
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
        let mut commits = Vec::new();

        for line in log_str.lines() {
            let parts: Vec<&str> = line.splitn(5, '|').collect();
            if parts.len() < 5 {
                continue;
            }

            let sha = parts[0].to_string();
            let short_sha = parts[1].to_string();
            let author = parts[2].to_string();
            let timestamp = chrono::DateTime::parse_from_rfc3339(parts[3])
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());
            let message = parts[4].to_string();

            // Get files changed count for this commit
            let stat_output = Command::new("git")
                .args(["diff-tree", "--no-commit-id", "--name-only", "-r", &sha])
                .current_dir(&self.repo_path)
                .output();

            let files_changed = stat_output
                .map(|o| String::from_utf8_lossy(&o.stdout).lines().count() as u32)
                .unwrap_or(0);

            commits.push(CommitInfo {
                sha,
                short_sha,
                message,
                author,
                timestamp,
                files_changed,
            });
        }

        Ok(commits)
    }

    /// Get diff for a specific commit, optionally filtered to a specific file
    pub fn diff(&self, commit_sha: &str, file_path: Option<&str>) -> Result<CommitDiff, GitError> {
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
}

/// Result of a push/pull operation
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushResult {
    pub success: bool,
    pub message: String,
    pub details: String,
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
    fn test_init_repo() {
        let (temp_dir, bm) = setup();

        assert!(!bm.is_git_repo());
        bm.init_repo().unwrap();
        assert!(bm.is_git_repo());

        // Check .gitignore was created
        assert!(temp_dir.path().join(".gitignore").exists());
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
}
