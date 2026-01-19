// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Error types for tend-git

use thiserror::Error;

#[derive(Error, Debug)]
pub enum GitError {
    #[error("Git repository error: {0}")]
    RepositoryError(String),

    #[error("Git operation failed: {0}")]
    OperationFailed(String),

    #[error("No changes to commit")]
    NoChanges,

    #[error("Remote not configured")]
    NoRemote,

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}
