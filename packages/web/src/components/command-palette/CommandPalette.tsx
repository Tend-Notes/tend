// SPDX-License-Identifier: MIT WITH Commons-Clause
import { Command } from 'cmdk'
import { useEffect, useState } from 'react'
import { usePageStore } from '../../stores/pageStore'
import { useUIStore } from '../../stores/uiStore'

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

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [search, setSearch] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { loadTodaysJournal, createPage, deletePage, currentPageName, currentPage } = usePageStore()
  const { toggleSidebar, openSearch } = useUIStore()

  // Reset search when closing
  useEffect(() => {
    if (!open) {
      setSearch('')
      setConfirmDelete(false)
    }
  }, [open])

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
      <div className="relative w-full max-w-lg bg-base-01 rounded-lg shadow-2xl border border-base-02 overflow-hidden">
        <Command.Input
          value={search}
          onValueChange={setSearch}
          placeholder="Type a command..."
          className="w-full px-4 py-3 bg-transparent border-b border-base-02 text-base-05 placeholder:text-base-04 focus:outline-none"
        />

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
              Settings
            </CommandItem>
          </Command.Group>
        </Command.List>
      </div>
    </Command.Dialog>
  )
}
