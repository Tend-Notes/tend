// SPDX-License-Identifier: MIT WITH Commons-Clause
import { Command } from 'cmdk'
import { useEffect, useState, useCallback } from 'react'
import { usePageStore } from '../../stores/pageStore'
import { useUIStore } from '../../stores/uiStore'
import { useSettingsStore, usesDateFolder, type ContentType } from '../../stores/settingsStore'
import { useSyncStatusStore } from '../../stores/syncStatusStore'
import { useToastStore } from '../../stores/toastStore'
import * as api from '../../lib/api'
import { formatDateYMD } from '../../lib/dateUtils'
import type { PageMeta } from '../../types'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Command item with optional keyboard shortcut
function CommandItem({
  children,
  shortcut,
  onSelect,
  value,
}: {
  children: React.ReactNode
  shortcut?: string
  onSelect: () => void
  value?: string
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex items-center justify-between px-3 py-2 text-sm rounded cursor-pointer data-[selected=true]:bg-base-02"
    >
      <span>{children}</span>
      {shortcut && (
        <kbd className="ml-auto text-xs text-base-04 font-mono">{shortcut}</kbd>
      )}
    </Command.Item>
  )
}

// DEV: Forced viewport mode for testing responsive styles
type ForcedViewport = 'none' | 'mobile' | 'tablet' | 'desktop'

function getForcedViewport(): ForcedViewport {
  if (typeof window === 'undefined') return 'none'
  return (localStorage.getItem('dev-forced-viewport') as ForcedViewport) || 'none'
}

function setForcedViewport(mode: ForcedViewport) {
  const html = document.documentElement
  // Remove all forced classes
  html.classList.remove('force-mobile', 'force-tablet', 'force-desktop')

  if (mode === 'none') {
    localStorage.removeItem('dev-forced-viewport')
  } else {
    localStorage.setItem('dev-forced-viewport', mode)
    html.classList.add(`force-${mode}`)
  }
}

// Apply forced viewport on load
if (typeof window !== 'undefined') {
  const saved = getForcedViewport()
  if (saved !== 'none') {
    document.documentElement.classList.add(`force-${saved}`)
  }
}

function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [search, setSearch] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [gitStatus, setGitStatus] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [showCommitInput, setShowCommitInput] = useState(false)
  const [creatingSheet, setCreatingSheet] = useState<ContentType | null>(null)
  const [linkingSheet, setLinkingSheet] = useState<{
    contentType: ContentType
    sheets: PageMeta[]
  } | null>(null)
  const [sheetName, setSheetName] = useState('')
  const [useToday, setUseToday] = useState(true)
  const [sheetDate, setSheetDate] = useState('')
  const [sheetError, setSheetError] = useState<string | null>(null)
  const [existingSheets, setExistingSheets] = useState<string[]>([])
  const [forcedViewport, setForcedViewportState] = useState<ForcedViewport>(getForcedViewport)
  const [reindexing, setReindexing] = useState(false)
  const [stabilizing, setStabilizing] = useState(false)
  const { loadTodaysJournal, createPage, deletePage, currentPageName, currentPage, clearRecentFiles, updateCurrentPageProperty } = usePageStore()
  const { toggleSidebar, openSearch, pendingContentType, pendingLinkContentType, clearPendingContentType, onSheetCreated, insertTextAtCursor, openImportDialog } = useUIStore()
  const { contentTypes } = useSettingsStore()

  // Custom content types (excluding built-in page and journal)
  const customContentTypes = contentTypes.filter(ct => ct.id !== 'page' && ct.id !== 'journal')

  // Reset search when closing
  useEffect(() => {
    if (!open) {
      setSearch('')
      setConfirmDelete(false)
      setGitStatus(null)
      setCommitMessage('')
      setShowCommitInput(false)
      setCreatingSheet(null)
      setLinkingSheet(null)
      setSheetName('')
      setUseToday(true)
      setSheetDate('')
      setSheetError(null)
      setExistingSheets([])
      setReindexing(false)
      clearPendingContentType()
    }
  }, [open, clearPendingContentType])

  // If opened with a pending content type (e.g., from slash command), start creating that sheet
  useEffect(() => {
    if (open && pendingContentType) {
      const ct = pendingContentType
      setCreatingSheet(ct)
      setSheetName('')
      setUseToday(true)
      setSheetDate(formatDateYMD(new Date()))
      setSheetError(null)
      clearPendingContentType()

      // Load existing sheets for collision detection
      api.sheets.list(ct.id)
        .then(sheets => setExistingSheets(sheets.map(s => s.name.toLowerCase())))
        .catch(() => setExistingSheets([]))
    }
  }, [open, pendingContentType, clearPendingContentType])

  // Start creating a sheet - show the name input form
  const handleStartCreateSheet = useCallback(async (contentType: ContentType) => {
    setSearch('') // Clear search so the form shows properly
    setCreatingSheet(contentType)
    setSheetName('')
    setUseToday(true)
    setSheetDate(formatDateYMD(new Date()))
    setSheetError(null)

    // Load existing sheets for collision detection
    try {
      const sheets = await api.sheets.list(contentType.id)
      // Extract just the names (lowercase for case-insensitive comparison)
      setExistingSheets(sheets.map(s => s.name.toLowerCase()))
    } catch {
      // If we can't load sheets, just continue without collision detection
      setExistingSheets([])
    }
  }, [])

  const handleStartLinkSheet = useCallback(async (ct: ContentType) => {
    try {
      const sheets = await api.sheets.list(ct.id)
      setLinkingSheet({ contentType: ct, sheets })
      setSearch('')
    } catch {
      setLinkingSheet({ contentType: ct, sheets: [] })
      setSearch('')
    }
  }, [])

  // If opened with a pending link content type (from slash command), start linking
  useEffect(() => {
    if (open && pendingLinkContentType) {
      const ct = pendingLinkContentType
      clearPendingContentType()
      handleStartLinkSheet(ct)
    }
  }, [open, pendingLinkContentType, clearPendingContentType, handleStartLinkSheet])

  // Insert wikilink for the sheet (lazy creation happens when link is clicked)
  const handleCreateSheet = useCallback(() => {
    if (!creatingSheet || !sheetName.trim()) return

    // Check for name collision (case-insensitive)
    const normalizedName = sheetName.trim().toLowerCase()
    if (existingSheets.includes(normalizedName)) {
      setSheetError(`A ${creatingSheet.name.toLowerCase()} named "${sheetName.trim()}" already exists`)
      return
    }

    // Build the wiki link path based on content type
    // Format: [[directory/name]] or [[directory/date/name]] for date-foldered types
    const dateOption = usesDateFolder(creatingSheet)
      ? (useToday ? formatDateYMD(new Date()) : sheetDate)
      : undefined
    const linkPath = usesDateFolder(creatingSheet) && dateOption
      ? `${creatingSheet.directory}/${dateOption}/${sheetName.trim()}`
      : `${creatingSheet.directory}/${sheetName.trim()}`
    const wikiLink = `[[${linkPath}]]`

    // Close dialog first, then invoke callback after dialog has closed
    // This ensures view.focus() in the callback runs after dialog is removed from DOM
    onOpenChange(false)
    setTimeout(() => {
      if (onSheetCreated) {
        onSheetCreated(wikiLink)
      } else if (insertTextAtCursor) {
        insertTextAtCursor(wikiLink + ' ')
      }
    }, 0)
  }, [creatingSheet, sheetName, useToday, sheetDate, onOpenChange, onSheetCreated, existingSheets, insertTextAtCursor])

  // Git: Commit now (auto-generated message)
  const handleGitCommitNow = useCallback(async () => {
    try {
      const result = await api.git.commit()
      if (result.commitSha) {
        setGitStatus(`Committed: ${result.message}`)
      } else {
        setGitStatus(result.message) // "No changes to commit"
      }
      setTimeout(() => onOpenChange(false), 1500)
    } catch (err) {
      setGitStatus(`Error: ${err instanceof Error ? err.message : 'Failed to commit'}`)
    }
  }, [onOpenChange])

  // Git: Commit with message
  const handleGitCommitWithMessage = useCallback(async () => {
    if (!commitMessage.trim()) {
      setShowCommitInput(true)
      return
    }

    try {
      const result = await api.git.commit(commitMessage.trim())
      if (result.commitSha) {
        setGitStatus(`Committed: ${commitMessage.trim()}`)
      } else {
        setGitStatus(result.message)
      }
      setCommitMessage('')
      setShowCommitInput(false)
      setTimeout(() => onOpenChange(false), 1500)
    } catch (err) {
      setGitStatus(`Error: ${err instanceof Error ? err.message : 'Failed to commit'}`)
    }
  }, [commitMessage, onOpenChange])

  // Git: View status
  const handleGitViewStatus = useCallback(async () => {
    try {
      const status = await api.git.status()
      if (!status.isRepo) {
        setGitStatus('Not a git repository')
      } else if (!status.hasChanges) {
        setGitStatus(`On branch ${status.branch || 'unknown'} - No uncommitted changes`)
      } else {
        const files = status.changedFiles?.length || 0
        setGitStatus(`On branch ${status.branch || 'unknown'} - ${files} file${files !== 1 ? 's' : ''} changed`)
      }
    } catch (err) {
      setGitStatus(`Error: ${err instanceof Error ? err.message : 'Failed to get status'}`)
    }
  }, [])

  // Git: Push to remote
  const handleGitPush = useCallback(async () => {
    try {
      setGitStatus('Pushing...')
      const result = await api.git.push()
      setGitStatus(result.message)
      useSyncStatusStore.getState().recordPush()
      setTimeout(() => onOpenChange(false), 1500)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to push'
      // Check for "no remote" error
      if (message.includes('NoRemote') || message.toLowerCase().includes('no remote')) {
        setGitStatus('No remote repository configured')
      } else {
        setGitStatus(`Error: ${message}`)
      }
    }
  }, [onOpenChange])

  // Git: Pull from remote
  const handleGitPull = useCallback(async () => {
    try {
      setGitStatus('Pulling...')
      const result = await api.git.pull()
      setGitStatus(result.message)
      setTimeout(() => onOpenChange(false), 1500)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to pull'
      if (message.includes('NoRemote') || message.toLowerCase().includes('no remote')) {
        setGitStatus('No remote repository configured')
      } else {
        setGitStatus(`Error: ${message}`)
      }
    }
  }, [onOpenChange])

  const handleCreatePage = () => {
    if (search.trim()) {
      createPage(search.trim())
      onOpenChange(false)
    }
  }

  const handleOpenSearch = () => {
    onOpenChange(false)
    // Small delay to let command palette close first
    setTimeout(() => openSearch(), 50)
  }

  const handleDeletePage = () => {
    if (!currentPageName || currentPage?.isJournal) return

    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }

    deletePage(currentPageName)
    onOpenChange(false)
  }

  // Toggle free text mode (hides bullets and indentation via CSS)
  const handleToggleFreeTextMode = useCallback(async () => {
    if (!currentPage) return

    const currentlyEnabled = currentPage.properties?.freeText === 'true'
    await updateCurrentPageProperty('freeText', currentlyEnabled ? null : 'true')
    onOpenChange(false)
  }, [currentPage, updateCurrentPageProperty, onOpenChange])

  // DEV: Rebuild all indices
  const handleRebuildIndices = useCallback(async () => {
    setReindexing(true)
    try {
      const result = await api.reindex.rebuildAll()
      const total = result.pagesIndexed + result.journalsIndexed
      useToastStore.getState().addToast(
        `Rebuilt indices for ${total} pages (${result.pagesIndexed} pages, ${result.journalsIndexed} journals)`,
        4000
      )
      onOpenChange(false)
    } catch (err) {
      useToastStore.getState().addToast(
        `Reindex failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        4000
      )
    } finally {
      setReindexing(false)
    }
  }, [onOpenChange])

  // DEV: Stabilize block UUIDs
  const handleStabilize = useCallback(async () => {
    setStabilizing(true)
    try {
      const result = await api.stabilize.stabilizeUuids()
      useToastStore.getState().addToast(
        `Stabilized ${result.stabilized} files (${result.alreadyStable} already stable${result.failed > 0 ? `, ${result.failed} failed` : ''})`,
        4000
      )
      onOpenChange(false)
    } catch (err) {
      useToastStore.getState().addToast(
        `Stabilize failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        4000
      )
    } finally {
      setStabilizing(false)
    }
  }, [onOpenChange])

  // Check if free text mode is currently enabled
  const isFreeTextEnabled = currentPage?.properties?.freeText === 'true'

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50"
        onClick={() => onOpenChange(false)}
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-lg mx-4 bg-base-01 rounded-lg shadow-2xl border border-base-02 overflow-hidden">
        {!creatingSheet && !linkingSheet && (
          <Command.Input
            value={search}
            onValueChange={setSearch}
            placeholder="Type a command..."
            className="w-full px-4 py-3 bg-transparent border-b border-base-02 text-base-05 placeholder:text-base-04 focus:outline-none"
          />
        )}

        {linkingSheet ? (
          // Link to existing sheet UI
          (() => {
            const query = search.toLowerCase().trim()
            const filtered = linkingSheet.sheets
              .filter(s => s.title.toLowerCase().includes(query) || s.name.toLowerCase().includes(query))
              .slice(0, 15)
            const newSheetPath = usesDateFolder(linkingSheet.contentType)
              ? `${linkingSheet.contentType.directory}/${new Date().toISOString().slice(0, 10)}/${search.trim()}`
              : `${linkingSheet.contentType.directory}/${search.trim()}`
            return (
              <>
                <Command.Input
                  autoFocus
                  value={search}
                  onValueChange={setSearch}
                  placeholder={`Search ${linkingSheet.contentType.name.toLowerCase()}s...`}
                  className="w-full px-4 py-3 bg-transparent border-b border-base-02 text-base-05 placeholder:text-base-04 focus:outline-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setLinkingSheet(null)
                  }}
                />
                <Command.List className="max-h-80 overflow-y-auto p-2">
                  {filtered.length === 0 && !search.trim() && (
                    <Command.Empty className="py-6 text-center text-sm text-base-04">
                      No {linkingSheet.contentType.name.toLowerCase()}s found. Type to create new.
                    </Command.Empty>
                  )}
                  {filtered.length > 0 && (
                    <Command.Group heading="Existing" className="mb-2">
                      {filtered.map((sheet) => {
                        const linkPath = sheet.name.startsWith(linkingSheet.contentType.directory + '/')
                          ? sheet.name
                          : `${linkingSheet.contentType.directory}/${sheet.name}`
                        return (
                          <Command.Item
                            key={sheet.name}
                            value={sheet.name}
                            onSelect={() => {
                              const wikiLink = `[[${linkPath}]]`
                              onOpenChange(false)
                              setLinkingSheet(null)
                              setTimeout(() => {
                                if (onSheetCreated) {
                                  onSheetCreated(wikiLink)
                                } else if (insertTextAtCursor) {
                                  insertTextAtCursor(wikiLink + ' ')
                                }
                              }, 0)
                            }}
                            className="flex items-center justify-between px-3 py-2 text-sm rounded cursor-pointer data-[selected=true]:bg-base-02"
                          >
                            <span>{sheet.title}</span>
                            {sheet.journalDate && (
                              <span className="ml-2 text-xs text-base-04">{sheet.journalDate}</span>
                            )}
                          </Command.Item>
                        )
                      })}
                    </Command.Group>
                  )}
                  {search.trim() && (
                    <Command.Group heading="Create new" className="mb-2">
                      <Command.Item
                        value={`create-${search}`}
                        onSelect={() => {
                          const wikiLink = `[[${newSheetPath}]]`
                          onOpenChange(false)
                          setLinkingSheet(null)
                          setTimeout(() => {
                            if (onSheetCreated) {
                              onSheetCreated(wikiLink)
                            } else if (insertTextAtCursor) {
                              insertTextAtCursor(wikiLink + ' ')
                            }
                          }, 0)
                        }}
                        className="flex items-center justify-between px-3 py-2 text-sm rounded cursor-pointer data-[selected=true]:bg-base-02"
                      >
                        <span>Create "{search.trim()}" ({linkingSheet.contentType.name})</span>
                      </Command.Item>
                    </Command.Group>
                  )}
                </Command.List>
              </>
            )
          })()
        ) : creatingSheet ? (
          // Modal sheet creation form - hides all other command palette content
          <div className="p-4 space-y-4">
            <div className="text-sm font-medium text-base-05">
              New {creatingSheet.name}
            </div>
            <input
              type="text"
              value={sheetName}
              onChange={(e) => {
                setSheetName(e.target.value)
                setSheetError(null) // Clear error when typing
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && sheetName.trim()) {
                  e.preventDefault()
                  handleCreateSheet()
                } else if (e.key === 'Escape') {
                  setCreatingSheet(null)
                }
              }}
              placeholder={`Enter ${creatingSheet.name.toLowerCase()} name...`}
              className={`w-full px-3 py-2 text-sm bg-base-00 border rounded focus:outline-none ${
                sheetError ? 'border-base-08 focus:border-base-08' : 'border-base-02 focus:border-base-04'
              }`}
              autoFocus
            />
            {sheetError && (
              <div className="text-xs text-base-08">{sheetError}</div>
            )}
            {/* Date options for date-foldered content types */}
            {usesDateFolder(creatingSheet) && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useToday}
                    onChange={(e) => setUseToday(e.target.checked)}
                    className="w-4 h-4 accent-base-0D"
                  />
                  <span className="text-sm text-base-05">Today</span>
                </label>
                {!useToday && (
                  <input
                    type="date"
                    value={sheetDate}
                    onChange={(e) => setSheetDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-base-00 border border-base-02 rounded focus:outline-none focus:border-base-04"
                  />
                )}
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleCreateSheet}
                disabled={!sheetName.trim()}
                className="px-4 py-2 text-sm bg-base-0D text-base-00 hover:bg-base-0C rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create
              </button>
              <button
                onClick={() => {
                  setCreatingSheet(null)
                  // If opened from slash command, close the palette entirely
                  if (pendingContentType) {
                    onOpenChange(false)
                  }
                }}
                className="px-4 py-2 text-sm text-base-04 hover:text-base-05"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-base-04">
              No results found.{' '}
              {search && (
                <button
                  onClick={handleCreatePage}
                  className="text-base-0D hover:underline"
                >
                  Create "{search}"
                </button>
              )}
            </Command.Empty>

            {/* Navigation */}
            <Command.Group heading="Navigation" className="mb-2">
              <CommandItem
                onSelect={handleOpenSearch}
                shortcut="Alt+Shift+F"
              >
                Search pages and blocks...
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  loadTodaysJournal()
                  onOpenChange(false)
                }}
                shortcut="Alt+Shift+T"
              >
                Go to today's journal
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  toggleSidebar()
                  onOpenChange(false)
                }}
                shortcut="Alt+Shift+S"
              >
                Toggle sidebar
              </CommandItem>
            </Command.Group>

            {/* Actions */}
            <Command.Group heading="Actions" className="mb-2">
              {search ? (
                <CommandItem onSelect={handleCreatePage}>
                  Create page "{search}"
                </CommandItem>
              ) : (
                <CommandItem onSelect={() => {}}>
                  Create new page...
                </CommandItem>
              )}
              {/* Custom content type link commands */}
              {customContentTypes.map((ct) => (
                <CommandItem
                  key={`link-${ct.id}`}
                  onSelect={() => handleStartLinkSheet(ct)}
                  value={`link to ${ct.name.toLowerCase()}`}
                >
                  Link to {ct.name}...
                </CommandItem>
              ))}
              {/* Custom content type create commands */}
              {customContentTypes.map((ct) => (
                <CommandItem
                  key={ct.id}
                  onSelect={() => handleStartCreateSheet(ct)}
                  value={`create new ${ct.name.toLowerCase()}`}
                >
                  New {ct.name}...
                </CommandItem>
              ))}
              {currentPageName && !currentPage?.isJournal && (
                <CommandItem
                  onSelect={handleDeletePage}
                  value="delete page"
                >
                  {confirmDelete ? (
                    <span className="text-base-08">
                      Click again to delete "{currentPage?.title || currentPageName}"
                    </span>
                  ) : (
                    `Delete this page`
                  )}
                </CommandItem>
              )}
              <CommandItem
                onSelect={() => {
                  clearRecentFiles()
                  onOpenChange(false)
                }}
                value="purge recent file list clear"
              >
                Purge recent file list
              </CommandItem>
              {currentPage && (
                <CommandItem
                  onSelect={handleToggleFreeTextMode}
                  value="toggle free text mode bullets outline"
                >
                  {isFreeTextEnabled ? 'Disable free text mode' : 'Enable free text mode'}
                </CommandItem>
              )}
            </Command.Group>

            {/* Git */}
            <Command.Group heading="Git" className="mb-2">
              {gitStatus && (
                <div className="px-3 py-2 text-xs text-base-04 bg-base-02 rounded mb-1">
                  {gitStatus}
                </div>
              )}
              {showCommitInput ? (
                <div className="px-3 py-2">
                  <input
                    type="text"
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleGitCommitWithMessage()
                      } else if (e.key === 'Escape') {
                        setShowCommitInput(false)
                        setCommitMessage('')
                      }
                    }}
                    placeholder="Enter commit message..."
                    className="w-full px-2 py-1 text-sm bg-base-00 border border-base-02 rounded focus:outline-none focus:border-base-04"
                    autoFocus
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={handleGitCommitWithMessage}
                      className="px-2 py-1 text-xs bg-base-02 hover:bg-base-03 rounded"
                    >
                      Commit
                    </button>
                    <button
                      onClick={() => {
                        setShowCommitInput(false)
                        setCommitMessage('')
                      }}
                      className="px-2 py-1 text-xs text-base-04 hover:text-base-05"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <CommandItem
                    onSelect={handleGitCommitNow}
                    value="git commit now"
                  >
                    Git: Commit now
                  </CommandItem>
                  <CommandItem
                    onSelect={() => setShowCommitInput(true)}
                    value="git commit with message"
                  >
                    Git: Commit with message...
                  </CommandItem>
                  <CommandItem
                    onSelect={handleGitViewStatus}
                    value="git view status"
                  >
                    Git: View status
                  </CommandItem>
                  <CommandItem
                    onSelect={handleGitPush}
                    value="git push"
                  >
                    Git: Push to remote
                  </CommandItem>
                  <CommandItem
                    onSelect={handleGitPull}
                    value="git pull"
                  >
                    Git: Pull from remote
                  </CommandItem>
                </>
              )}
            </Command.Group>

            {/* Import */}
            <Command.Group heading="Import" className="mb-2">
              <CommandItem
                onSelect={() => {
                  openImportDialog()
                  onOpenChange(false)
                }}
                value="import from logseq"
              >
                Import from Logseq
              </CommandItem>
            </Command.Group>

            {/* Help */}
            <Command.Group heading="Help" className="mb-2">
              <CommandItem
                onSelect={() => onOpenChange(false)}
                shortcut="Shift+?"
              >
                Keyboard shortcuts
              </CommandItem>
              <CommandItem
                onSelect={() => onOpenChange(false)}
                shortcut="Alt+Shift+O"
              >
                Options
              </CommandItem>
            </Command.Group>

            {/* Dev Tools */}
            <Command.Group heading="Dev" className="mb-2">
              <CommandItem
                onSelect={handleRebuildIndices}
                value="dev rebuild indices reindex backlinks search"
              >
                {reindexing ? 'DEV: Rebuilding indices...' : 'DEV: Rebuild Indices'}
              </CommandItem>
              <CommandItem
                onSelect={handleStabilize}
                value="dev stabilize page uuids fix import backlinks footer"
              >
                {stabilizing ? 'DEV: Stabilizing UUIDs...' : 'DEV: Stabilize Page UUIDs'}
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  const next = forcedViewport === 'mobile' ? 'none' : 'mobile'
                  setForcedViewport(next)
                  setForcedViewportState(next)
                  onOpenChange(false)
                }}
                value="dev switch mobile ui"
              >
                DEV: {forcedViewport === 'mobile' ? 'Exit mobile UI' : 'Switch to mobile UI'}
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  const next = forcedViewport === 'tablet' ? 'none' : 'tablet'
                  setForcedViewport(next)
                  setForcedViewportState(next)
                  onOpenChange(false)
                }}
                value="dev switch tablet ui"
              >
                DEV: {forcedViewport === 'tablet' ? 'Exit tablet UI' : 'Switch to tablet UI'}
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  const next = forcedViewport === 'desktop' ? 'none' : 'desktop'
                  setForcedViewport(next)
                  setForcedViewportState(next)
                  onOpenChange(false)
                }}
                value="dev switch desktop ui"
              >
                DEV: {forcedViewport === 'desktop' ? 'Exit desktop UI' : 'Switch to desktop UI'}
              </CommandItem>
              {forcedViewport !== 'none' && (
                <CommandItem
                  onSelect={() => {
                    setForcedViewport('none')
                    setForcedViewportState('none')
                    onOpenChange(false)
                  }}
                  value="dev reset viewport"
                >
                  DEV: Reset to auto viewport
                </CommandItem>
              )}
            </Command.Group>
          </Command.List>
        )}
      </div>
    </Command.Dialog>
  )
}

export default CommandPalette
