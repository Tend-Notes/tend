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
            });
        }

        // Check for changes
        let status_output = Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::OperationFailed(e.to_string()))?;

        let has_changes = !status_output.stdout.is_empty();

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
        })
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
