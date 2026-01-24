// SPDX-License-Identifier: MIT WITH Commons-Clause
// Sidebar history view - shows git commit history for the current page

import { useEffect, useState, useCallback } from 'react'
import type { CommitInfo, CommitDiff, FileDiff } from '../../types'
import * as api from '../../lib/api'

interface SidebarHistoryProps {
  onBack: () => void
  /** Current page name (e.g., "my-page" or journal date "2026-01-19") */
  pageName: string | null
  /** Whether the current page is a journal */
  isJournal: boolean
}

/**
 * Convert a page name to its file path in the git repo.
 * Pages are stored in pages/{name}.md, journals in journals/{date}.md
 */
function pageNameToFilePath(pageName: string, isJournal: boolean): string {
  if (isJournal) {
    // Journal dates are stored as YYYY-MM-DD.md
    return `journals/${pageName}.md`
  }
  return `pages/${pageName}.md`
}

function SidebarHistory({ onBack, pageName, isJournal }: SidebarHistoryProps) {
  const [commits, setCommits] = useState<CommitInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null)
  const [commitDiff, setCommitDiff] = useState<CommitDiff | null>(null)
  const [isLoadingDiff, setIsLoadingDiff] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchHistory = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      // Filter history by current page's file path
      const filePath = pageName ? pageNameToFilePath(pageName, isJournal) : undefined
      const history = await api.git.history(50, filePath)
      setCommits(history)
    } catch (err) {
      console.error('Failed to fetch history:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch history')
      setCommits([])
    } finally {
      setIsLoading(false)
    }
  }, [pageName, isJournal])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  // Get the file path for the current page (for filtering diffs)
  const filePath = pageName ? pageNameToFilePath(pageName, isJournal) : undefined

  const handleSelectCommit = async (sha: string) => {
    if (selectedCommit === sha) {
      setSelectedCommit(null)
      setCommitDiff(null)
      return
    }

    setSelectedCommit(sha)
    setIsLoadingDiff(true)
    try {
      // Pass the file path to only show diff for the current page
      const diff = await api.git.diff(sha, filePath)
      setCommitDiff(diff)
    } catch (err) {
      console.error('Failed to fetch diff:', err)
      setCommitDiff(null)
    } finally {
      setIsLoadingDiff(false)
    }
  }

  const handleRestore = async (sha: string) => {
    const target = filePath ? `this page to commit ${sha.slice(0, 7)}` : `all files to commit ${sha.slice(0, 7)}`
    if (!confirm(`Restore ${target}? Your current changes will be saved first.`)) {
      return
    }

    try {
      // Pass the file path to restore only the current page
      await api.git.restore(sha, filePath)
      window.location.reload()
    } catch (err) {
      console.error('Failed to restore:', err)
      alert('Failed to restore: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-base-02">
        <button
          onClick={onBack}
          className="p-1 text-base-04 hover:text-base-05 transition-colors"
          title="Back to navigation"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-medium text-base-05">History</span>
        <button
          onClick={fetchHistory}
          className="p-1 text-base-04 hover:text-base-05 transition-colors"
          title="Refresh"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Page indicator */}
      {pageName && (
        <div className="px-3 py-2 border-b border-base-02 bg-base-01">
          <div className="text-[10px] text-base-04 truncate">
            {isJournal ? 'Journal' : 'Page'}: <span className="text-base-05">{pageName}</span>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="p-4 text-sm text-base-04">Loading history...</div>
        )}

        {error && (
          <div className="p-4">
            {error.includes('No such file or directory') || error.includes('Not a git repository') ? (
              <div className="space-y-3">
                <p className="text-sm text-base-05">Version History</p>
                <p className="text-xs text-base-04">
                  Track changes to your documents with git-based versioning.
                </p>
                <div className="p-2 bg-base-01 border border-base-02 rounded text-xs text-base-04">
                  <p className="font-medium text-base-05 mb-1">To enable:</p>
                  <ol className="list-decimal list-inside space-y-1">
                    <li>Open Settings (Alt+Shift+O)</li>
                    <li>Go to Backup section</li>
                    <li>Toggle "Enable versions"</li>
                  </ol>
                </div>
                <p className="text-xs text-base-03">
                  This creates automatic snapshots of your work that you can browse and restore.
                </p>
              </div>
            ) : (
              <div className="text-sm text-base-08">{error}</div>
            )}
          </div>
        )}

        {!isLoading && !error && commits.length === 0 && (
          <div className="p-4 text-sm text-base-04">
            {pageName ? 'No changes to this page yet.' : 'No page selected.'}
          </div>
        )}

        {!isLoading && commits.length > 0 && (
          <div className="divide-y divide-base-02">
            {commits.map((commit) => (
              <div key={commit.sha}>
                {/* Commit header */}
                <button
                  onClick={() => handleSelectCommit(commit.sha)}
                  className={`w-full p-3 text-left hover:bg-base-02 transition-colors ${
                    selectedCommit === commit.sha ? 'bg-base-02' : ''
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <svg
                      className={`w-3 h-3 mt-1 text-base-04 transition-transform flex-shrink-0 ${
                        selectedCommit === commit.sha ? 'rotate-90' : ''
                      }`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-base-05 truncate">
                        {commit.message}
                      </div>
                      <div className="text-[10px] text-base-04 mt-0.5">
                        <span className="font-mono">{commit.shortSha}</span>
                        <span className="mx-1">·</span>
                        <span>{formatRelativeTime(commit.timestamp)}</span>
                      </div>
                    </div>
                  </div>
                </button>

                {/* Expanded diff view */}
                {selectedCommit === commit.sha && (
                  <div className="bg-base-00 border-t border-base-02">
                    {isLoadingDiff && (
                      <div className="p-3 text-xs text-base-04">Loading diff...</div>
                    )}

                    {!isLoadingDiff && commitDiff && (
                      <div>
                        {/* Restore button */}
                        <div className="p-2 border-b border-base-02">
                          <button
                            onClick={() => handleRestore(commit.sha)}
                            className="px-2 py-1 text-[10px] bg-base-02 hover:bg-base-03 rounded transition-colors"
                          >
                            Restore to this version
                          </button>
                        </div>

                        {/* File diffs */}
                        {commitDiff.files.length === 0 ? (
                          <div className="p-3 text-xs text-base-04">No file changes</div>
                        ) : (
                          <div className="divide-y divide-base-02">
                            {commitDiff.files.map((file, index) => (
                              <FileDiffView key={index} file={file} />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Individual file diff view
function FileDiffView({ file }: { file: FileDiff }) {
  const [isExpanded, setIsExpanded] = useState(true)

  const statusColors: Record<string, string> = {
    added: 'text-base-0B',
    modified: 'text-base-0A',
    deleted: 'text-base-08',
    renamed: 'text-base-0D',
    untracked: 'text-base-04',
  }

  const statusLabels: Record<string, string> = {
    added: 'A',
    modified: 'M',
    deleted: 'D',
    renamed: 'R',
    untracked: '?',
  }

  return (
    <div>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-1.5 text-left text-[10px] flex items-center gap-1.5 hover:bg-base-01 transition-colors"
      >
        <span className={`font-mono ${statusColors[file.status] || 'text-base-04'}`}>
          {statusLabels[file.status] || '?'}
        </span>
        <span className="text-base-05 truncate flex-1">{file.path}</span>
        <svg
          className={`w-2.5 h-2.5 text-base-04 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {isExpanded && file.diff && (
        <div className="px-3 pb-2 overflow-x-auto">
          <pre className="text-[9px] font-mono leading-relaxed">
            {file.diff.split('\n').slice(0, 20).map((line, i) => (
              <DiffLine key={i} line={line} />
            ))}
            {file.diff.split('\n').length > 20 && (
              <div className="text-base-04 italic">... {file.diff.split('\n').length - 20} more lines</div>
            )}
          </pre>
        </div>
      )}
    </div>
  )
}

// Individual diff line with coloring
function DiffLine({ line }: { line: string }) {
  let className = 'text-base-04'

  if (line.startsWith('+') && !line.startsWith('+++')) {
    className = 'text-base-0B bg-base-0B/10'
  } else if (line.startsWith('-') && !line.startsWith('---')) {
    className = 'text-base-08 bg-base-08/10'
  } else if (line.startsWith('@@')) {
    className = 'text-base-0D'
  } else if (line.startsWith('diff') || line.startsWith('index') || line.startsWith('---') || line.startsWith('+++')) {
    className = 'text-base-03'
  }

  return <div className={`${className} whitespace-pre`}>{line || ' '}</div>
}

// Format relative time
function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`

  return date.toLocaleDateString()
}

export default SidebarHistory
