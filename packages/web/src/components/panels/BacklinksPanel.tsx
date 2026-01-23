// SPDX-License-Identifier: MIT WITH Commons-Clause
// Backlinks panel - shows pages/blocks that link to the current page

import { useEffect, useState } from 'react'
import type { BacklinkRef } from '../../types'
import * as api from '../../lib/api'
import { usePageStore } from '../../stores/pageStore'

interface BacklinksPanelProps {
  pageName: string
}

export function BacklinksPanel({ pageName }: BacklinksPanelProps) {
  const [backlinks, setBacklinks] = useState<BacklinkRef[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const { navigateToPage, navigateToJournal } = usePageStore()

  useEffect(() => {
    if (!pageName) return

    let cancelled = false
    setIsLoading(true)

    api.pages.getBacklinks(pageName)
      .then((refs) => {
        if (!cancelled) {
          setBacklinks(refs)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to fetch backlinks:', err)
          setBacklinks([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [pageName])

  // Group backlinks by page
  const groupedBacklinks = backlinks.reduce(
    (acc, ref) => {
      if (!acc[ref.pageName]) {
        acc[ref.pageName] = {
          pageTitle: ref.pageTitle,
          isJournal: ref.isJournal,
          journalDate: ref.journalDate,
          blocks: [],
        }
      }
      acc[ref.pageName].blocks.push({
        uuid: ref.blockUuid,
        content: ref.blockContent,
      })
      return acc
    },
    {} as Record<string, { pageTitle: string; isJournal: boolean; journalDate: string | null; blocks: { uuid: string; content: string }[] }>
  )

  const pageCount = Object.keys(groupedBacklinks).length
  const blockCount = backlinks.length

  if (isLoading) {
    return (
      <div className="border-t border-base-02 pt-6 mt-6">
        <div className="text-sm text-base-04">Loading backlinks...</div>
      </div>
    )
  }

  return (
    <div className="border-t border-base-02 pt-6 mt-6">
      {/* Header */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="flex items-center gap-2 text-sm text-base-04 hover:text-base-05 transition-colors mb-4"
      >
        <svg
          className={`w-4 h-4 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="font-medium">Linked References</span>
        <span className="text-base-03">
          {blockCount > 0 ? `${blockCount} block${blockCount !== 1 ? 's' : ''} from ${pageCount} page${pageCount !== 1 ? 's' : ''}` : 'None'}
        </span>
      </button>

      {/* Backlinks list */}
      {!isCollapsed && blockCount > 0 && (
        <div className="space-y-4">
          {Object.entries(groupedBacklinks).map(([pageNameKey, { pageTitle, isJournal, journalDate, blocks }]) => (
            <div key={pageNameKey} className="bg-base-01 rounded-lg border border-base-02 overflow-hidden">
              {/* Page header */}
              <button
                onClick={() => {
                  if (isJournal && journalDate) {
                    navigateToJournal(journalDate)
                  } else {
                    navigateToPage(pageNameKey)
                  }
                }}
                className="w-full px-4 py-2 text-left text-sm font-medium text-base-0D hover:bg-base-02 transition-colors border-b border-base-02"
              >
                {pageTitle}
              </button>

              {/* Blocks from this page */}
              <div className="divide-y divide-base-02">
                {blocks.map((block) => (
                  <div
                    key={block.uuid}
                    className="px-4 py-3 text-sm text-base-05 hover:bg-base-01 transition-colors"
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-base-03 mt-0.5">•</span>
                      <span className="flex-1">
                        <HighlightedContent content={block.content} currentPageName={pageName} />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isCollapsed && blockCount === 0 && (
        <div className="text-sm text-base-03 italic">
          No pages link to this page yet.
        </div>
      )}
    </div>
  )
}

/**
 * Safely render content with highlighted wiki-links.
 * Uses React elements instead of dangerouslySetInnerHTML to prevent XSS.
 */
function HighlightedContent({ content, currentPageName }: { content: string; currentPageName: string }) {
  // Parse content into segments: text and wiki-links
  const segments: Array<{ type: 'text' | 'link'; value: string }> = []
  const linkRegex = /\[\[([^\]]+)\]\]/g
  let lastIndex = 0
  let match

  while ((match = linkRegex.exec(content)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: content.slice(lastIndex, match.index) })
    }
    // Add the link
    segments.push({ type: 'link', value: match[1] })
    lastIndex = match.index + match[0].length
  }

  // Add remaining text
  if (lastIndex < content.length) {
    segments.push({ type: 'text', value: content.slice(lastIndex) })
  }

  return (
    <>
      {segments.map((segment, i) => {
        if (segment.type === 'text') {
          return <span key={i}>{segment.value}</span>
        }
        const isCurrentPage = segment.value.toLowerCase() === currentPageName.toLowerCase()
        return (
          <span
            key={i}
            className={isCurrentPage ? 'text-base-0E font-medium' : 'text-base-0D'}
          >
            [[{segment.value}]]
          </span>
        )
      })}
    </>
  )
}
