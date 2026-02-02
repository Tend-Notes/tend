// SPDX-License-Identifier: MIT WITH Commons-Clause
// Dialog for importing a Logseq graph from a zip file

import { useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { importApi, type ImportProgress } from '../../lib/api'

interface LogseqImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ImportStage =
  | 'select' // Selecting file
  | 'options' // Configuring options
  | 'importing' // Import in progress
  | 'completed' // Import finished

interface ImportState {
  stage: ImportStage
  file: File | null
  overwrite: boolean
  importAssets: boolean
  hasAssets: boolean
  progress: ImportProgress | null
  progressLog: ImportProgress[]
  result: {
    pagesImported: number
    journalsImported: number
    skipped: number
    failed: number
  } | null
  error: string | null
}

export function LogseqImportDialog({ open, onOpenChange }: LogseqImportDialogProps) {
  const [state, setState] = useState<ImportState>({
    stage: 'select',
    file: null,
    overwrite: false,
    importAssets: false,
    hasAssets: false,
    progress: null,
    progressLog: [],
    result: null,
    error: null,
  })

  const fileInputRef = useRef<HTMLInputElement>(null)

  const resetState = useCallback(() => {
    setState({
      stage: 'select',
      file: null,
      overwrite: false,
      importAssets: false,
      hasAssets: false,
      progress: null,
      progressLog: [],
      result: null,
      error: null,
    })
  }, [])

  const handleClose = useCallback(() => {
    onOpenChange(false)
    // Reset state after dialog closes
    setTimeout(resetState, 200)
  }, [onOpenChange, resetState])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      // Validate it's a zip file
      if (!file.name.toLowerCase().endsWith('.zip')) {
        setState(prev => ({ ...prev, error: 'Please select a .zip file' }))
        return
      }
      setState(prev => ({
        ...prev,
        file,
        stage: 'options',
        error: null,
      }))
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) {
      if (!file.name.toLowerCase().endsWith('.zip')) {
        setState(prev => ({ ...prev, error: 'Please select a .zip file' }))
        return
      }
      setState(prev => ({
        ...prev,
        file,
        stage: 'options',
        error: null,
      }))
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleImport = useCallback(async () => {
    if (!state.file) return

    setState(prev => ({
      ...prev,
      stage: 'importing',
      progress: null,
      progressLog: [],
      error: null,
    }))

    try {
      await importApi.uploadLogseqZip(
        state.file,
        { overwrite: state.overwrite, importAssets: state.importAssets },
        (progress) => {
          setState(prev => {
            // Check if we detected assets during extraction
            const hasAssets = progress.type === 'completed' ? progress.hasAssets : prev.hasAssets

            // Update result if completed
            const result = progress.type === 'completed'
              ? {
                  pagesImported: progress.pagesImported,
                  journalsImported: progress.journalsImported,
                  skipped: progress.skipped,
                  failed: progress.failed,
                }
              : prev.result

            // Check for error
            const error = progress.type === 'error' ? progress.message : prev.error

            // Determine stage
            const stage = progress.type === 'completed' || progress.type === 'error'
              ? 'completed'
              : prev.stage

            return {
              ...prev,
              progress,
              progressLog: [...prev.progressLog, progress],
              hasAssets,
              result,
              error,
              stage,
            }
          })
        }
      )
    } catch (err) {
      setState(prev => ({
        ...prev,
        stage: 'completed',
        error: err instanceof Error ? err.message : 'Import failed',
      }))
    }
  }, [state.file, state.overwrite, state.importAssets])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50"
        onClick={handleClose}
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-lg mx-4 bg-base-01 rounded-lg shadow-2xl border border-base-02 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-base-02">
          <h2 className="text-sm font-medium text-base-06">Import from Logseq</h2>
          <button
            onClick={handleClose}
            className="p-1 text-base-04 hover:text-base-05 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          <AnimatePresence mode="wait">
            {state.stage === 'select' && (
              <motion.div
                key="select"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >
                {/* File drop zone */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-base-02 rounded-lg cursor-pointer hover:border-base-04 transition-colors"
                >
                  <svg className="w-12 h-12 text-base-03 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <p className="text-sm text-base-05 mb-1">
                    Drop your Logseq graph zip file here
                  </p>
                  <p className="text-xs text-base-03">
                    or click to browse
                  </p>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip"
                  onChange={handleFileSelect}
                  className="hidden"
                />

                {state.error && (
                  <p className="text-xs text-base-08">{state.error}</p>
                )}

                <p className="text-xs text-base-03">
                  Export your Logseq graph as a zip file from Logseq's settings,
                  then import it here.
                </p>
              </motion.div>
            )}

            {state.stage === 'options' && (
              <motion.div
                key="options"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >
                {/* Selected file */}
                <div className="flex items-center gap-3 p-3 bg-base-02 rounded">
                  <svg className="w-8 h-8 text-base-0D flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-base-05 truncate">{state.file?.name}</p>
                    <p className="text-xs text-base-03">
                      {state.file ? formatFileSize(state.file.size) : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => setState(prev => ({ ...prev, file: null, stage: 'select' }))}
                    className="p-1 text-base-04 hover:text-base-05 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Options */}
                <div className="space-y-3">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={state.overwrite}
                      onChange={(e) => setState(prev => ({ ...prev, overwrite: e.target.checked }))}
                      className="w-4 h-4 mt-0.5 accent-base-0D"
                    />
                    <div>
                      <span className="text-sm text-base-05">Overwrite existing files</span>
                      <p className="text-xs text-base-03">
                        Replace files that already exist in this garden
                      </p>
                    </div>
                  </label>

                  {/* Asset import option - shown only after we detect assets */}
                  {state.hasAssets && (
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={state.importAssets}
                        onChange={(e) => setState(prev => ({ ...prev, importAssets: e.target.checked }))}
                        className="w-4 h-4 mt-0.5 accent-base-0D"
                      />
                      <div>
                        <span className="text-sm text-base-05">Import assets</span>
                        <p className="text-xs text-base-03">
                          Import images and other assets from the graph
                        </p>
                      </div>
                    </label>
                  )}
                </div>

                {state.error && (
                  <p className="text-xs text-base-08">{state.error}</p>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => setState(prev => ({ ...prev, file: null, stage: 'select' }))}
                    className="px-4 py-2 text-sm text-base-04 hover:text-base-05 transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleImport}
                    className="px-4 py-2 text-sm bg-base-0D text-base-00 rounded hover:opacity-90 transition-opacity"
                  >
                    Import
                  </button>
                </div>
              </motion.div>
            )}

            {state.stage === 'importing' && (
              <motion.div
                key="importing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >
                {/* Progress indicator */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-base-0D border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-base-05">
                      {getProgressMessage(state.progress)}
                    </span>
                  </div>

                  {/* Progress bar for processing stage */}
                  {state.progress?.type === 'processing' && (
                    <div className="h-1 bg-base-02 rounded overflow-hidden">
                      <div
                        className="h-full bg-base-0D transition-all"
                        style={{
                          width: `${(state.progress.current / state.progress.total) * 100}%`,
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Recent log entries */}
                <div className="max-h-40 overflow-y-auto space-y-1 text-xs text-base-04">
                  {state.progressLog.slice(-10).map((entry, i) => (
                    <div key={i} className={getLogEntryClass(entry)}>
                      {getLogEntryText(entry)}
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {state.stage === 'completed' && (
              <motion.div
                key="completed"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >
                {state.error ? (
                  <>
                    <div className="flex items-center gap-3 text-base-08">
                      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <div>
                        <p className="text-sm font-medium">Import failed</p>
                        <p className="text-xs text-base-04">{state.error}</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-3 text-base-0B">
                      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div>
                        <p className="text-sm font-medium">Import complete</p>
                      </div>
                    </div>

                    {/* Results summary */}
                    {state.result && (
                      <div className="grid grid-cols-2 gap-2 p-3 bg-base-02 rounded text-sm">
                        <div>
                          <p className="text-base-03">Pages</p>
                          <p className="text-base-05 font-medium">{state.result.pagesImported}</p>
                        </div>
                        <div>
                          <p className="text-base-03">Journals</p>
                          <p className="text-base-05 font-medium">{state.result.journalsImported}</p>
                        </div>
                        {state.result.skipped > 0 && (
                          <div>
                            <p className="text-base-03">Skipped</p>
                            <p className="text-base-09 font-medium">{state.result.skipped}</p>
                          </div>
                        )}
                        {state.result.failed > 0 && (
                          <div>
                            <p className="text-base-03">Failed</p>
                            <p className="text-base-08 font-medium">{state.result.failed}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Asset notice */}
                    {state.hasAssets && !state.importAssets && (
                      <p className="text-xs text-base-09">
                        This graph contains assets (images, etc.) that were not imported.
                        Re-import with the "Import assets" option to include them.
                      </p>
                    )}

                    {/* Failed files notice */}
                    {state.result && state.result.failed > 0 && (
                      <p className="text-xs text-base-04">
                        {state.result.failed} files failed to import. You can review them in
                        Settings &gt; Import &gt; Import Errors.
                      </p>
                    )}
                  </>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={handleClose}
                    className="px-4 py-2 text-sm bg-base-02 text-base-05 rounded hover:bg-base-03 transition-colors"
                  >
                    Done
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getProgressMessage(progress: ImportProgress | null): string {
  if (!progress) return 'Starting import...'

  switch (progress.type) {
    case 'started':
      return progress.message
    case 'extracting':
      return progress.message
    case 'processing':
      return `Processing ${progress.current} of ${progress.total} files...`
    case 'imported':
    case 'skipped':
    case 'failed':
      return 'Processing files...'
    case 'completed':
      return 'Import complete'
    case 'error':
      return 'Import failed'
    default:
      return 'Working...'
  }
}

function getLogEntryClass(entry: ImportProgress): string {
  switch (entry.type) {
    case 'imported':
      return 'text-base-0B'
    case 'skipped':
      return 'text-base-09'
    case 'failed':
    case 'error':
      return 'text-base-08'
    default:
      return 'text-base-04'
  }
}

function getLogEntryText(entry: ImportProgress): string {
  switch (entry.type) {
    case 'started':
    case 'extracting':
      return entry.message
    case 'processing':
      return `Processing: ${entry.file}`
    case 'imported':
      return `Imported: ${entry.file}`
    case 'skipped':
      return `Skipped: ${entry.file} (${entry.reason})`
    case 'failed':
      return `Failed: ${entry.file} - ${entry.error}`
    case 'completed':
      return `Done: ${entry.pagesImported} pages, ${entry.journalsImported} journals`
    case 'error':
      return `Error: ${entry.message}`
    default:
      return ''
  }
}
