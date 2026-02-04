// SPDX-License-Identifier: MIT WITH Commons-Clause
// Import error editor component - edits failed import files before saving

import { useCallback, useState, useMemo, useEffect } from 'react'
import { usePageStore } from '../../stores/pageStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { Page, Block } from '../../types'
import { Plots } from './plots/Plots'

interface ImportErrorEditorProps {
  errorName: string
  originalName: string
  error: string
  timestamp: string
  page: Page
  fileName: string
  hasUnsavedChanges: boolean
}

/**
 * Detects if a filename is a journal conflict file and extracts the date.
 * Patterns:
 * - 2024_01_12_2.md -> 2024-01-12 (underscore-separated date with conflict suffix)
 * - 2024-01-12_2.md -> 2024-01-12 (ISO date with conflict suffix)
 * - 2024_01_12.md -> 2024-01-12 (underscore-separated date)
 */
function detectJournalDate(originalName: string): string | null {
  // Remove .md extension if present
  const baseName = originalName.replace(/\.md$/i, '')

  // Pattern 1: YYYY_MM_DD or YYYY_MM_DD_N (underscore-separated with optional conflict suffix)
  const underscorePattern = /^(\d{4})_(\d{2})_(\d{2})(?:_\d+)?$/
  const underscoreMatch = baseName.match(underscorePattern)
  if (underscoreMatch) {
    return `${underscoreMatch[1]}-${underscoreMatch[2]}-${underscoreMatch[3]}`
  }

  // Pattern 2: YYYY-MM-DD or YYYY-MM-DD_N (ISO date with optional conflict suffix)
  const isoPattern = /^(\d{4})-(\d{2})-(\d{2})(?:_\d+)?$/
  const isoMatch = baseName.match(isoPattern)
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
  }

  return null
}

export function ImportErrorEditor({
  originalName,
  error,
  timestamp,
  page,
  fileName,
  hasUnsavedChanges,
}: ImportErrorEditorProps) {
  const updateImportError = usePageStore((state) => state.updateImportError)
  const updateImportErrorFileName = usePageStore((state) => state.updateImportErrorFileName)
  const saveImportError = usePageStore((state) => state.saveImportError)
  const discardImportError = usePageStore((state) => state.discardImportError)
  const closeImportErrorEditor = usePageStore((state) => state.closeImportErrorEditor)
  const { contentTypes } = useSettingsStore()

  // Detect if this is a journal conflict file
  const detectedJournalDate = useMemo(() => detectJournalDate(originalName), [originalName])

  // Default to journal if we detected a journal date, otherwise page
  const [selectedContentType, setSelectedContentType] = useState(() =>
    detectedJournalDate ? 'journal' : 'page'
  )
  const [journalDate, setJournalDate] = useState(() => detectedJournalDate || '')
  const [saving, setSaving] = useState(false)
  const [discarding, setDiscarding] = useState(false)

  // Update journal date when detected date changes (e.g., on mount)
  useEffect(() => {
    if (detectedJournalDate && !journalDate) {
      setJournalDate(detectedJournalDate)
    }
  }, [detectedJournalDate, journalDate])

  // All content types are saveable now (including journal with date picker)
  const saveableContentTypes = contentTypes

  // Handle close with unsaved changes confirmation
  const handleClose = useCallback(() => {
    if (hasUnsavedChanges) {
      if (!confirm('You have unsaved changes. Discard them?')) {
        return
      }
    }
    closeImportErrorEditor()
  }, [hasUnsavedChanges, closeImportErrorEditor])

  // Handle save
  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      // Pass date for journal content type
      const date = selectedContentType === 'journal' ? journalDate : undefined
      await saveImportError(selectedContentType, date)
    } finally {
      setSaving(false)
    }
  }, [saveImportError, selectedContentType, journalDate])

  // Handle discard
  const handleDiscard = useCallback(async () => {
    if (!confirm('Permanently delete this import error? This cannot be undone.')) {
      return
    }
    setDiscarding(true)
    try {
      await discardImportError()
    } finally {
      setDiscarding(false)
    }
  }, [discardImportError])

  // Route block updates through updateImportError
  const handleBlocksChange = useCallback(
    (blocks: Block[], rootBlocksHint?: string[]) => {
      updateImportError(blocks, rootBlocksHint)
    },
    [updateImportError]
  )

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Import error mode header banner */}
      <div className="bg-base-08/10 border-b border-base-08/30 px-4 py-2">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Warning icon */}
            <svg
              className="w-4 h-4 text-base-08"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <span className="text-sm text-base-08 font-medium">
              Editing import error: {originalName}
            </span>
            {hasUnsavedChanges && (
              <span className="text-xs text-base-0A">(unsaved)</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDiscard}
              disabled={discarding}
              className="px-3 py-1 text-xs font-medium text-base-08 hover:bg-base-08/10 rounded transition-colors disabled:opacity-50"
            >
              {discarding ? 'Discarding...' : 'Discard'}
            </button>
            <button
              onClick={handleClose}
              className="px-3 py-1 text-xs font-medium text-base-05 bg-base-02 hover:bg-base-03 rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      {/* Editor area */}
      <div className="flex-1 overflow-y-auto bg-base-00">
        <div className="page-content px-2 py-3 pb-24 md:max-w-2xl md:mx-auto md:px-6 md:py-12 md:pb-12">
          {/* Error info */}
          <div className="mb-6 p-3 bg-base-08/5 border border-base-08/20 rounded">
            <p className="text-sm text-base-08 mb-1">Import failed: {error}</p>
            <p className="text-xs text-base-04">
              {new Date(timestamp).toLocaleString()}
            </p>
          </div>

          {/* Filename input */}
          <div className="mb-6">
            <label className="block text-xs text-base-04 mb-1">
              File name (without .md extension)
            </label>
            <input
              type="text"
              value={fileName}
              onChange={(e) => updateImportErrorFileName(e.target.value)}
              className="w-full bg-base-01 border border-base-02 rounded px-3 py-2 text-sm text-base-05 focus:outline-none focus:border-base-04"
              placeholder="Enter file name..."
            />
          </div>

          {/* Content type and save controls */}
          <div className="mb-6 space-y-3">
            <div className="flex items-center gap-3">
              <select
                value={selectedContentType}
                onChange={(e) => setSelectedContentType(e.target.value)}
                className="flex-1 bg-base-01 border border-base-02 rounded px-3 py-2 text-sm text-base-05 focus:outline-none focus:border-base-04"
              >
                {saveableContentTypes.map((ct) => (
                  <option key={ct.id} value={ct.id}>
                    Save as: {ct.name}
                  </option>
                ))}
              </select>
              <button
                onClick={handleSave}
                disabled={saving || !fileName.trim() || (selectedContentType === 'journal' && !journalDate)}
                className="px-4 py-2 text-sm font-medium text-base-00 bg-base-0D hover:bg-base-0D/80 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>

            {/* Date picker for journal content type */}
            {selectedContentType === 'journal' && (
              <div className="flex items-center gap-3">
                <label className="text-xs text-base-04">Journal date:</label>
                <input
                  type="date"
                  value={journalDate}
                  onChange={(e) => setJournalDate(e.target.value)}
                  className="bg-base-01 border border-base-02 rounded px-3 py-2 text-sm text-base-05 focus:outline-none focus:border-base-04"
                />
                {detectedJournalDate && journalDate === detectedJournalDate && (
                  <span className="text-xs text-base-0B">(auto-detected)</span>
                )}
              </div>
            )}

            {/* Info message for journal merging */}
            {selectedContentType === 'journal' && (
              <p className="text-xs text-base-04 bg-base-01 border border-base-02 rounded px-3 py-2">
                If a journal for this date already exists, the content will be appended to the existing journal.
              </p>
            )}
          </div>

          {/* Help text */}
          <div className="mb-6 p-3 bg-base-01 border border-base-02 rounded text-xs text-base-04">
            <p>
              Edit the content below, then choose a content type and save. The file will be created in the appropriate directory.
            </p>
          </div>

          {/* The editor - using Plots with custom onBlocksChange */}
          <Plots page={page} onBlocksChange={handleBlocksChange} />
        </div>
      </div>
    </div>
  )
}
