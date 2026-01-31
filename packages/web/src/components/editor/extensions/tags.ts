// SPDX-License-Identifier: MIT WITH Commons-Clause
// Tag extension for CodeMirror
//
// Highlights #tag patterns in the editor with the tag color from tagStore.
// Tags are clickable and navigate to the tag page.

import {
  EditorView,
  Decoration,
  DecorationSet,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { Extension, Range } from '@codemirror/state'

// Regex to match tags: #word (alphanumeric + underscores/hyphens)
// Tag must be at start of content or preceded by whitespace
const TAG_REGEX = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_-]*)/g

interface TagSpan {
  from: number
  to: number
  name: string
}

/**
 * Find all tags in the document
 */
function findTags(doc: string): TagSpan[] {
  const results: TagSpan[] = []
  let match
  TAG_REGEX.lastIndex = 0

  while ((match = TAG_REGEX.exec(doc)) !== null) {
    // Adjust position for the leading whitespace/start
    const leadingWhitespace = match[0].length - match[1].length - 1 // -1 for #
    const from = match.index + leadingWhitespace
    const to = match.index + match[0].length

    results.push({
      from,
      to,
      name: match[1],
    })
  }

  return results
}

/**
 * Widget that renders a tag as a colored pill
 */
class TagWidget extends WidgetType {
  constructor(
    readonly name: string,
    readonly getHue: (name: string) => number,
    readonly onNavigate?: (name: string) => void
  ) {
    super()
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'tag-pill'
    span.textContent = `#${this.name}`
    // Set hue as CSS custom property for HSL-based styling
    const hue = this.getHue(this.name)
    span.style.setProperty('--tag-hue', String(hue))
    span.style.cursor = 'pointer'

    // Use mousedown to prevent CodeMirror from handling the event first
    span.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.button === 0) {
        this.onNavigate?.(`tags/${this.name}`)
      }
    })

    return span
  }

  eq(other: TagWidget): boolean {
    return other.name === this.name
  }

  ignoreEvent(): boolean {
    return false
  }
}

interface TagExtensionOptions {
  getHue: (name: string) => number
  onNavigate?: (target: string) => void
}

/**
 * Build decorations for tags in the document
 */
function buildTagDecorations(
  view: EditorView,
  options: TagExtensionOptions
): DecorationSet {
  const decorations: Range<Decoration>[] = []
  const doc = view.state.doc.toString()
  const cursorPos = view.state.selection.main.head
  const hasFocus = view.hasFocus

  const tags = findTags(doc)

  for (const tag of tags) {
    // Check if cursor is inside this tag
    const cursorInTag = hasFocus && cursorPos >= tag.from && cursorPos <= tag.to

    if (cursorInTag) {
      // Show as styled text (not widget) when cursor is inside
      decorations.push(
        Decoration.mark({ class: 'tag' }).range(tag.from, tag.to)
      )
    } else {
      // Replace with widget when cursor is outside
      decorations.push(
        Decoration.replace({
          widget: new TagWidget(tag.name, options.getHue, options.onNavigate),
        }).range(tag.from, tag.to)
      )
    }
  }

  // Sort by position
  decorations.sort((a, b) => a.from - b.from)

  return Decoration.set(decorations)
}

/**
 * ViewPlugin that manages tag decorations
 */
function createTagPlugin(options: TagExtensionOptions) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildTagDecorations(view, options)
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.focusChanged) {
          this.decorations = buildTagDecorations(update.view, options)
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  )
}

/**
 * Extension that highlights #tags as colored pills.
 */
export function tagExtension(options: TagExtensionOptions): Extension {
  return createTagPlugin(options)
}
