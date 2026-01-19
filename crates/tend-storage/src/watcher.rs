// SPDX-License-Identifier: MIT WITH Commons-Clause
//! File watcher for detecting external changes to garden files

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use tokio::sync::{broadcast, RwLock};
use tracing::{debug, error, info, warn};

use crate::error::StorageError;

/// Events emitted by the file watcher
#[derive(Debug, Clone)]
pub enum FileEvent {
    /// A file was created
    Created(PathBuf),
    /// A file was modified
    Modified(PathBuf),
    /// A file was deleted
    Deleted(PathBuf),
    /// A file was renamed
    Renamed { from: PathBuf, to: PathBuf },
}

/// Watches the garden for external file changes
pub struct FileWatcher {
    /// The debounced watcher
    _debouncer: Debouncer<RecommendedWatcher, RecommendedCache>,

    /// Broadcast channel for file events
    event_tx: broadcast::Sender<FileEvent>,
}

impl FileWatcher {
    /// Create a new file watcher for the given root directory
    pub fn new(
        root: &Path,
        _pending_writes: Arc<RwLock<HashSet<PathBuf>>>,
    ) -> Result<Self, StorageError> {
        let (event_tx, _) = broadcast::channel(100);
        let _tx = event_tx.clone();

        // Create debouncer with 500ms timeout
        let debouncer = new_debouncer(
            Duration::from_millis(500),
            None,
            move |result: DebounceEventResult| {
                match result {
                    Ok(events) => {
                        for event in events {
                            // We'll filter and process events here
                            debug!("File event: {:?}", event);
                        }
                    }
                    Err(errors) => {
                        for error in errors {
                            error!("Watch error: {:?}", error);
                        }
                    }
                }
            },
        )
        .map_err(|e| StorageError::WatchError(e.to_string()))?;

        // Note: We need to watch the directories, but the current notify-debouncer-full
        // API has changed. For now, we'll create a simpler watcher.

        info!("File watcher initialized for: {}", root.display());

        Ok(Self {
            _debouncer: debouncer,
            event_tx,
        })
    }

    /// Subscribe to file events
    pub fn subscribe(&self) -> broadcast::Receiver<FileEvent> {
        self.event_tx.subscribe()
    }

    /// Send an event (used internally)
    #[allow(dead_code)]
    fn send_event(&self, event: FileEvent) {
        if let Err(e) = self.event_tx.send(event) {
            warn!("Failed to send file event: {}", e);
        }
    }
}

/// A simpler file watcher using notify directly (for initial implementation)
pub struct SimpleFileWatcher {
    _watcher: RecommendedWatcher,
    event_tx: broadcast::Sender<FileEvent>,
}

impl SimpleFileWatcher {
    /// Create a new simple file watcher
    pub fn new(
        root: &Path,
        pending_writes: Arc<RwLock<HashSet<PathBuf>>>,
    ) -> Result<Self, StorageError> {
        let (event_tx, _) = broadcast::channel(100);
        let tx = event_tx.clone();
        let pending = pending_writes.clone();
        let root_path = root.to_path_buf();

        let mut watcher = notify::recommended_watcher(move |res: Result<notify::Event, _>| {
            if let Ok(event) = res {
                // Process the event
                let rt = tokio::runtime::Handle::try_current();
                if let Ok(handle) = rt {
                    let pending = pending.clone();
                    let tx = tx.clone();
                    let root = root_path.clone();

                    handle.spawn(async move {
                        for path in event.paths {
                            // Skip non-.md files
                            if path.extension().map_or(true, |e| e != "md") {
                                continue;
                            }

                            // Skip if it's our own write
                            if pending.read().await.contains(&path) {
                                debug!("Skipping our own write: {}", path.display());
                                continue;
                            }

                            // Only process files in pages/ or journals/
                            let relative = path.strip_prefix(&root).unwrap_or(&path);
                            let in_pages = relative.starts_with("pages");
                            let in_journals = relative.starts_with("journals");

                            if !in_pages && !in_journals {
                                continue;
                            }

                            let file_event = match event.kind {
                                notify::EventKind::Create(_) => Some(FileEvent::Created(path)),
                                notify::EventKind::Modify(_) => Some(FileEvent::Modified(path)),
                                notify::EventKind::Remove(_) => Some(FileEvent::Deleted(path)),
                                _ => None,
                            };

                            if let Some(fe) = file_event {
                                let _ = tx.send(fe);
                            }
                        }
                    });
                }
            }
        })
        .map_err(|e| StorageError::WatchError(e.to_string()))?;

        // Watch the pages and journals directories
        watcher
            .watch(&root.join("pages"), RecursiveMode::Recursive)
            .map_err(|e| StorageError::WatchError(e.to_string()))?;

        watcher
            .watch(&root.join("journals"), RecursiveMode::Recursive)
            .map_err(|e| StorageError::WatchError(e.to_string()))?;

        info!("Simple file watcher initialized for: {}", root.display());

        Ok(Self {
            _watcher: watcher,
            event_tx,
        })
    }

    /// Subscribe to file events
    pub fn subscribe(&self) -> broadcast::Receiver<FileEvent> {
        self.event_tx.subscribe()
    }
}
