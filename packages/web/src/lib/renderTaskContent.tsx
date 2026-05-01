// SPDX-License-Identifier: MIT WITH Commons-Clause
import { type ReactNode } from 'react'

// Regex to find wikilinks in content: [[target]]
const WIKILINK_REGEX = /\[\[([^\]]+)\]\]/g

// Render task content with wikilinks as clickable links
export function renderContentWithWikilinks(
  content: string,
  navigateToPage: (name: string) => void,
  navigateToJournal: (date: string) => void
): ReactNode {
  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  WIKILINK_REGEX.lastIndex = 0
  while ((match = WIKILINK_REGEX.exec(content)) !== null) {
    // Add text before the wikilink
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index))
    }

    const target = match[1]
    // Display name: strip prefix directories, show only the final segment
    const lastSlash = target.lastIndexOf('/')
    const displayName = lastSlash >= 0 ? target.slice(lastSlash + 1) : target

    parts.push(
      <a
        key={match.index}
        className="wiki-link"
        href="#"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (target.startsWith('journals/')) {
            navigateToJournal(target.slice('journals/'.length))
          } else {
            navigateToPage(target)
          }
        }}
      >
        {displayName}
      </a>
    )

    lastIndex = match.index + match[0].length
  }

  // Add remaining text after last wikilink
  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex))
  }

  // If no wikilinks found, return original content
  if (parts.length === 0) return content

  return <>{parts}</>
}
