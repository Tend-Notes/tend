// SPDX-License-Identifier: MIT WITH Commons-Clause
// Template editor component - edits content type templates

import { useCallback } from 'react'
import { usePageStore } from '../../stores/pageStore'
import type { Page, Block } from '../../types'
import { Plots } from './plots/Plots'

interface TemplateEditorProps {
  contentTypeName: string
  page: Page
  hasUnsavedChanges: boolean
}

export function TemplateEditor({
  contentTypeName,
  page,
  hasUnsavedChanges,
}: TemplateEditorProps) {
  const updateTemplate = usePageStore((state) => state.updateTemplate)
  const saveTemplate = usePageStore((state) => state.saveTemplate)
  const closeTemplateEditor = usePageStore((state) => state.closeTemplateEditor)

  // Handle close with unsaved changes confirmation
  const handleClose = useCallback(() => {
    if (hasUnsavedChanges) {
      if (!confirm('You have unsaved changes. Discard them?')) {
        return
      }
    }
    closeTemplateEditor()
  }, [hasUnsavedChanges, closeTemplateEditor])

  // Handle save
  const handleSave = useCallback(async () => {
    await saveTemplate()
  }, [saveTemplate])

  // Route block updates through updateTemplate instead of updateCurrentPage
  const handleBlocksChange = useCallback(
    (blocks: Block[], rootBlocksHint?: string[]) => {
      updateTemplate(blocks, rootBlocksHint)
    },
    [updateTemplate]
  )

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Template mode header banner */}
      <div className="bg-base-0E/10 border-b border-base-0E/30 px-4 py-2">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Template icon */}
            <svg
              className="w-4 h-4 text-base-0E"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
              />
            </svg>
            <span className="text-sm text-base-0E font-medium">
              Editing template for: {contentTypeName}
            </span>
            {hasUnsavedChanges && (
              <span className="text-xs text-base-0A">(unsaved)</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={!hasUnsavedChanges}
              className="px-3 py-1 text-xs font-medium text-base-00 bg-base-0E hover:bg-base-0E/80 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save
            </button>
            <button
              onClick={handleClose}
              className="px-3 py-1 text-xs font-medium text-base-05 bg-base-02 hover:bg-base-03 rounded transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Editor area */}
      <div className="flex-1 overflow-y-auto bg-base-00">
        <div className="page-content px-2 py-3 pb-24 md:max-w-2xl md:mx-auto md:px-6 md:py-12 md:pb-12">
          {/* Template title */}
          <div className="flex items-center gap-3 mb-8">
            <h1 className="text-xl font-semibold text-base-06">
              {contentTypeName} Template
            </h1>
          </div>

          {/* Template help text */}
          <div className="mb-6 p-3 bg-base-01 border border-base-02 rounded text-xs text-base-04">
            <p className="mb-2">
              This template will be used when creating new {contentTypeName.toLowerCase()} sheets.
            </p>
            <p>
              Tip: Use <code className="px-1 py-0.5 bg-base-02 rounded font-mono">{'{{cursor}}'}</code> to set where the cursor should be placed.
            </p>
          </div>

          {/* The editor - using Plots with custom onBlocksChange */}
          <Plots page={page} onBlocksChange={handleBlocksChange} />
        </div>
      </div>
    </div>
  )
}
