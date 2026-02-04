// SPDX-License-Identifier: MIT WITH Commons-Clause
// Import error editor component - edits failed import files before saving

import { useCallback, useState, useMemo } from 'react'
import { usePageStore } from '../../stores/pageStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { Page, Block } from '../../types'
import { Plots } from './plots/Plots'
import { DatePickerPopover } from '../ui/DatePickerPopover'
import { formatShortDate } from '../../lib/dateUtils'

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
 * Detects if a filename contains a date and extracts it.
 * Scans the first ~10 characters for a date pattern:
 * - YYYY (19xx or 20xx), then optionally any separator, then MM (01-12), then optionally any separator, then DD (01-31)
 *
 * Examples:
 * - "2022_01_11 2" -> 2022-01-11
 * - "2022-01-11_2" -> 2022-01-11
 * - "2022 01 11 notes" -> 2022-01-11
 * - "20220111_anything" -> 2022-01-11
 * - "2022.01.11.md" -> 2022-01-11
 */
function detectJournalDate(originalName: string): string | null {
  // Remove .md extension if present
  const baseName = originalName.replace(/\.md$/i, '')

  // Look at the first ~10 characters for the date pattern
  const prefix = baseName.slice(0, 12)

  // Match: 4-digit year (19xx or 20xx), optional separator, 2-digit month, optional separator, 2-digit day
  // Separators can be: underscore, dash, space, dot, or nothing
  const pattern = /^(19\d{2}|20\d{2})[-_ .]?(\d{2})[-_ .]?(\d{2})/
  const match = prefix.match(pattern)

  if (match) {
    const year = match[1]
    const month = parseInt(match[2], 10)
    const day = parseInt(match[3], 10)

    // Validate month (01-12) and day (01-31)
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${match[2]}-${match[3]}`
    }
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
  // Default to today's date if not detected (consistent with CommandPalette date picker)
  const [journalDate, setJournalDate] = useState(() =>
    detectedJournalDate || new Date().toISOString().split('T')[0]
  )
  const [saving, setSaving] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)

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
                <div className="relative">
                  <button
                    onClick={() => setShowDatePicker(!showDatePicker)}
                    className="inline-flex items-center gap-2 px-3 py-2 bg-base-01 border border-base-02 rounded text-sm text-base-05 hover:bg-base-02 transition-colors"
                  >
                    {/* Calendar icon */}
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span>{formatShortDate(journalDate)}</span>
                  </button>
                  {showDatePicker && (
                    <DatePickerPopover
                      value={journalDate}
                      onChange={(date) => {
                        if (date) setJournalDate(date)
                      }}
                      onClose={() => setShowDatePicker(false)}
                      label="Journal Date"
                    />
                  )}
                </div>
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
