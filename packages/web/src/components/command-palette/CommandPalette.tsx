// SPDX-License-Identifier: MIT WITH Commons-Clause
import { useShallow } from 'zustand/react/shallow'
import { Command } from 'cmdk'
import { useEffect, useState, useCallback } from 'react'
import { LinkPicker } from './LinkPicker'
import { usePageStore } from '../../stores/pageStore'
import { useUIStore } from '../../stores/uiStore'
import { useSettingsStore, usesDate, type ContentType } from '../../stores/settingsStore'
import { useSyncStatusStore } from '../../stores/syncStatusStore'
import { useToastStore } from '../../stores/toastStore'
import * as api from '../../lib/api'
import { qualifyName } from '../../lib/name'
import { HeatmapCalendar } from '../ui/HeatmapCalendar'
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
  const [linkingSheet, setLinkingSheet] = useState<{
    contentType: ContentType
    sheets: PageMeta[]
  } | null>(null)
  // Optional second-layer filter on the Link panel: narrows results to a sheet
  // date (journalDate) for date-organized content types. '' = no date filter.
  const [linkDate, setLinkDate] = useState('')
  const [showLinkCal, setShowLinkCal] = useState(false)
  // Selected namespace ("book") for namespaced/Compilation content types. The
  // keyboard/filter model itself now lives in <LinkPicker>.
  const [linkNamespace, setLinkNamespace] = useState('')
  const [forcedViewport, setForcedViewportState] = useState<ForcedViewport>(getForcedViewport)
  const [reindexing, setReindexing] = useState(false)
  const [stabilizing, setStabilizing] = useState(false)
  const { loadTodaysJournal, createPage, deletePage, currentPageName, currentPage, clearRecentFiles, updateCurrentPageProperty, openTaskManager } = usePageStore(useShallow((s) => ({ loadTodaysJournal: s.loadTodaysJournal, createPage: s.createPage, deletePage: s.deletePage, currentPageName: s.currentPageName, currentPage: s.currentPage, clearRecentFiles: s.clearRecentFiles, updateCurrentPageProperty: s.updateCurrentPageProperty, openTaskManager: s.openTaskManager })))
  const { toggleSidebar, openSearch, setSidebarMode, pendingContentType, pendingLinkContentType, clearPendingContentType, onSheetCreated, insertTextAtCursor, openImportDialog } = useUIStore(useShallow((s) => ({ toggleSidebar: s.toggleSidebar, openSearch: s.openSearch, setSidebarMode: s.setSidebarMode, pendingContentType: s.pendingContentType, pendingLinkContentType: s.pendingLinkContentType, clearPendingContentType: s.clearPendingContentType, onSheetCreated: s.onSheetCreated, insertTextAtCursor: s.insertTextAtCursor, openImportDialog: s.openImportDialog })))
  const contentTypes = useSettingsStore((s) => s.contentTypes)

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
      setLinkingSheet(null)
      setLinkDate('')
      setLinkNamespace('')
      setShowLinkCal(false)
      setReindexing(false)
      clearPendingContentType()
    }
  }, [open, clearPendingContentType])

  const handleStartLinkSheet = useCallback(async (ct: ContentType) => {
    setSearch('')
    setLinkDate('')
    setLinkNamespace('')
    setShowLinkCal(false)
    try {
      const sheets = await api.sheets.list(ct.id)
      setLinkingSheet({ contentType: ct, sheets })
    } catch {
      setLinkingSheet({ contentType: ct, sheets: [] })
    }
  }, [])

  // Opened with a pending content type (from a slash command) — whether the
  // "link" or the (now-removed) "create" entry, both land in the Link panel,
  // which handles linking AND creation.
  useEffect(() => {
    const ct = pendingLinkContentType || pendingContentType
    if (open && ct) {
      clearPendingContentType()
      handleStartLinkSheet(ct)
    }
  }, [open, pendingLinkContentType, pendingContentType, clearPendingContentType, handleStartLinkSheet])


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

  // Convert a blank, non-journal page into Longform Mode (a single wall-of-text
  // block, edited without bullets). Only offered on blank pages so there's no
  // outline-to-prose migration to do.
  const handleConvertToLongform = useCallback(async () => {
    if (!currentPage || currentPage.isJournal) return
    if (currentPage.properties?.longform === 'true') return
    await updateCurrentPageProperty('longform', 'true')
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

  // Longform conversion is offered only on a blank, non-journal page that isn't
  // already longform (blank = no blocks, or a single empty block).
  const isBlankPage =
    !!currentPage &&
    (currentPage.rootBlocks.length === 0 ||
      (currentPage.rootBlocks.length === 1 &&
        (currentPage.blocks[currentPage.rootBlocks[0]]?.content ?? '') === ''))
  const canConvertToLongform =
    !!currentPageName &&
    !currentPage?.isJournal &&
    currentPage?.properties?.longform !== 'true' &&
    isBlankPage

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
        {!linkingSheet && (
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
            const ct = linkingSheet.contentType
            const isDated = usesDate(ct)
            const isNamespaced = ct.organization === 'namespaced'
            // Display name: for namespaced sheets it's the leaf (last path
            // segment); otherwise the title (or leaf as a fallback).
            const nameOf = (s: PageMeta) =>
              isNamespaced ? (s.name.split('/').pop() || s.title || '') : (s.title || s.name.split('/').pop() || '')
            // A listed sheet's namespace ("book"): the first path segment after the directory.
            const nsOf = (s: PageMeta) => {
              const rel = s.name.startsWith(ct.directory + '/') ? s.name.slice(ct.directory.length + 1) : s.name
              return rel.includes('/') ? rel.split('/')[0] : ''
            }
            const namespaces = [...new Set(linkingSheet.sheets.map(nsOf).filter(Boolean))].sort()
            // Filter predicate for the picker: match the leaf title OR the full name.
            const matchSheet = (s: PageMeta, q: string) =>
              nameOf(s).toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
            // Insert a wikilink for the chosen/created target and close the panel.
            const insertLink = (target: string) => {
              const wikiLink = `[[${target}]]`
              onOpenChange(false)
              setLinkingSheet(null)
              setTimeout(() => {
                if (onSheetCreated) {
                  onSheetCreated(wikiLink)
                } else if (insertTextAtCursor) {
                  insertTextAtCursor(wikiLink + ' ')
                }
              }, 0)
            }
            // Canonical link path for an existing sheet (its name may or may not
            // already carry the content-type directory prefix).
            const linkPathOf = (s: PageMeta) =>
              s.name.startsWith(ct.directory + '/') ? s.name : `${ct.directory}/${s.name}`

            // Namespaced/Compilation types step within ONE picker: choose or
            // create a compilation (the middle folder), then the same control
            // swaps to files within it — same keyboard flow at each step.
            if (isNamespaced) {
              const compilation = linkNamespace.trim()
              if (!compilation) {
                return (
                  <LinkPicker
                    key="compilations"
                    autoFocus
                    items={namespaces}
                    getKey={(n) => n}
                    getLabel={(n) => n}
                    placeholder={`Choose or create a ${ct.name.toLowerCase()}…`}
                    canCreate={(box) => box.trim().length > 0 && !namespaces.some(n => n.toLowerCase() === box.trim().toLowerCase())}
                    createLabel={(box) => `Create ${ct.name.toLowerCase()} "${box.trim()}"`}
                    onPick={(n) => setLinkNamespace(n)}
                    onCreate={(box) => setLinkNamespace(box.trim())}
                    onEscape={() => setLinkingSheet(null)}
                  />
                )
              }
              const files = linkingSheet.sheets.filter(s => nsOf(s) === compilation)
              return (
                <>
                  <div className="flex items-center gap-2 border-b border-base-02 px-4 py-2 text-xs text-base-04">
                    <button onClick={() => setLinkNamespace('')} className="text-base-04 hover:text-base-05" title="Back to compilations">‹ back</button>
                    <span>{ct.name}</span>
                    <span>▸</span>
                    <span className="text-base-05">{compilation}</span>
                  </div>
                  <LinkPicker
                    key={`files:${compilation}`}
                    autoFocus
                    items={files}
                    getKey={(s) => s.name}
                    getLabel={nameOf}
                    matches={matchSheet}
                    placeholder="Choose or create a file…"
                    canCreate={(box) => box.trim().length > 0 && !linkingSheet.sheets.some(s => s.name === qualifyName(ct, `${compilation}/${box.trim()}`))}
                    createLabel={(box) => `Create "${box.trim()}" in ${compilation}`}
                    onPick={(s) => insertLink(linkPathOf(s))}
                    onCreate={(box) => insertLink(qualifyName(ct, `${compilation}/${box.trim()}`))}
                    onEscape={() => setLinkNamespace('')}
                    onExitBackward={() => setLinkNamespace('')}
                  />
                </>
              )
            }

            // Flat or dated: one picker. Dated types get a calendar date-filter
            // (as the input's headerRight) and create on the picked date, else
            // today. Flat types (a Page with just a category) get neither.
            const createDate = isDated ? (linkDate || new Date().toISOString().slice(0, 10)) : undefined
            const dateFiltered = linkingSheet.sheets.filter(s => !linkDate || s.journalDate === linkDate)
            const dateFilter = isDated ? (
              <div className="relative flex items-center gap-1 pr-3">
                {linkDate && (
                  <span className="text-xs text-base-05">
                    {linkDate}
                    <button
                      onClick={() => setLinkDate('')}
                      className="ml-1 text-base-04 hover:text-base-05"
                      title="Clear date filter"
                    >
                      ×
                    </button>
                  </span>
                )}
                {/* Same calendar icon + picker as the journal page. */}
                <button
                  onClick={() => setShowLinkCal((v) => !v)}
                  className={`p-1 transition-colors ${linkDate ? 'text-base-0D' : 'text-base-04 hover:text-base-05'}`}
                  title="Filter by date"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </button>
                {showLinkCal && (
                  <HeatmapCalendar
                    currentDate={linkDate || undefined}
                    onSelectDate={(d) => setLinkDate(d)}
                    onClose={() => setShowLinkCal(false)}
                    heatmap={false}
                    align="right"
                  />
                )}
              </div>
            ) : undefined
            return (
              <LinkPicker
                key={`sheets:${ct.id}`}
                autoFocus
                items={dateFiltered}
                getKey={(s) => s.name}
                getLabel={nameOf}
                getMeta={(s) => s.journalDate || undefined}
                matches={matchSheet}
                placeholder={`Search ${ct.name.toLowerCase()}s…`}
                canCreate={(box) => box.trim().length > 0 && !linkingSheet.sheets.some(s => s.name === qualifyName(ct, box.trim(), createDate))}
                createLabel={(box) => `Create "${box.trim()}" (${ct.name})${isDated && linkDate ? ` on ${linkDate}` : ''}`}
                onPick={(s) => insertLink(linkPathOf(s))}
                onCreate={(box) => insertLink(qualifyName(ct, box.trim(), createDate))}
                onEscape={() => setLinkingSheet(null)}
                headerRight={dateFilter}
                bodyMinHeight={showLinkCal ? '320px' : undefined}
              />
            )
          })()
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
              <CommandItem onSelect={handleOpenSearch}>
                Search pages and blocks...
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  loadTodaysJournal()
                  onOpenChange(false)
                }}
              >
                Go to today's journal
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  openTaskManager()
                  onOpenChange(false)
                }}
              >
                Open task manager
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  toggleSidebar()
                  onOpenChange(false)
                }}
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
              {/* Custom content type: one entry that links to existing OR creates new */}
              {customContentTypes.map((ct) => (
                <CommandItem
                  key={`link-${ct.id}`}
                  onSelect={() => handleStartLinkSheet(ct)}
                  value={`link or create ${ct.name.toLowerCase()} new`}
                >
                  Link or create {ct.name}...
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
              {canConvertToLongform && (
                <CommandItem
                  onSelect={handleConvertToLongform}
                  value="convert longform mode wall of text prose no bullets"
                >
                  Convert to Longform
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
                shortcut="Ctrl+Shift+/"
              >
                Keyboard shortcuts
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  setSidebarMode('options')
                  onOpenChange(false)
                }}
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
