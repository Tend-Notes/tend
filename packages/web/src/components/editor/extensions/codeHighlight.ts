// SPDX-License-Identifier: MIT WITH Commons-Clause
// Code syntax highlighting extension for CodeMirror
//
// Uses lowlight (highlight.js compatible) to apply syntax highlighting
// classes to code content within fenced code blocks.

import { Extension, Range } from '@codemirror/state'
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view'
import { createLowlight } from 'lowlight'

// Import only common languages to keep bundle size reasonable
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import go from 'highlight.js/lib/languages/go'
import json from 'highlight.js/lib/languages/json'
import yaml from 'highlight.js/lib/languages/yaml'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import html from 'highlight.js/lib/languages/xml'
import markdown from 'highlight.js/lib/languages/markdown'
import sql from 'highlight.js/lib/languages/sql'

// Initialize lowlight with common languages
const lowlight = createLowlight()
lowlight.register('javascript', javascript)
lowlight.register('js', javascript)
lowlight.register('typescript', typescript)
lowlight.register('ts', typescript)
lowlight.register('python', python)
lowlight.register('py', python)
lowlight.register('rust', rust)
lowlight.register('rs', rust)
lowlight.register('go', go)
lowlight.register('golang', go)
lowlight.register('json', json)
lowlight.register('yaml', yaml)
lowlight.register('yml', yaml)
lowlight.register('bash', bash)
lowlight.register('sh', bash)
lowlight.register('shell', bash)
lowlight.register('css', css)
lowlight.register('html', html)
lowlight.register('xml', html)
lowlight.register('markdown', markdown)
lowlight.register('md', markdown)
lowlight.register('sql', sql)

// Map highlight.js class names to decorations
function createClassDecoration(className: string): Decoration {
  return Decoration.mark({
    class: className,
  })
}

// Extract code content from fenced code block, returning offset and code
function extractCodeContent(content: string): { code: string; offset: number } | null {
  // Match fenced code block: ```lang\n...code...\n```
  const match = content.match(/^```[\w+#-]*\r?\n([\s\S]*?)\r?\n```$/)
  if (match) {
    // Find where the code starts (after opening fence + newline)
    const openingFenceEnd = content.indexOf('\n') + 1
    return { code: match[1], offset: openingFenceEnd }
  }
  // No fence markers, treat entire content as code
  return { code: content, offset: 0 }
}

// Parse highlighted content and create decorations
function highlightContent(content: string, language: string): DecorationSet {
  const decorations: { from: number; to: number; decoration: Decoration }[] = []

  // Extract just the code portion (excluding fence markers)
  const extracted = extractCodeContent(content)
  if (!extracted) return Decoration.none
  const { code, offset } = extracted

  try {
    // Use lowlight to parse the code content
    const result = language && lowlight.registered(language)
      ? lowlight.highlight(language, code)
      : lowlight.highlightAuto(code)

    // Walk the HAST tree and collect decorations
    let pos = 0
    function processNode(node: any) {
      if (node.type === 'text') {
        pos += node.value.length
      } else if (node.type === 'element') {
        const startPos = pos
        // Process children
        if (node.children) {
          for (const child of node.children) {
            processNode(child)
          }
        }
        const endPos = pos
        // Add decoration for this element
        if (node.properties?.className && startPos < endPos) {
          const classes = Array.isArray(node.properties.className)
            ? node.properties.className.join(' ')
            : node.properties.className
          decorations.push({
            from: startPos,
            to: endPos,
            decoration: createClassDecoration(classes),
          })
        }
      } else if (node.children) {
        for (const child of node.children) {
          processNode(child)
        }
      }
    }

    for (const child of result.children) {
      processNode(child)
    }

    // Sort by position and build decoration set
    decorations.sort((a, b) => a.from - b.from || a.to - b.to)
  } catch {
    // If highlighting fails, return empty set
    return Decoration.none
  }

  // Apply offset to position decorations correctly in the full content
  return Decoration.set(
    decorations.map(d => d.decoration.range(d.from + offset, d.to + offset)),
    true
  )
}

/**
 * Create a CodeMirror extension that applies syntax highlighting
 * to code content using lowlight.
 *
 * @param language - The language identifier (e.g., "js", "rust", "python")
 */
export function codeHighlightExtension(language: string): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view, language)
      }

      buildDecorations(view: EditorView, lang: string): DecorationSet {
        const content = view.state.doc.toString()
        const docLength = view.state.doc.length

        // Skip highlighting for very short content or empty code blocks
        if (content.length < 7) return Decoration.none // Minimum: ```\n\n```

        const decorations = highlightContent(content, lang)

        // Validate all decorations are within document bounds
        // Invalid ranges can cause CodeMirror rendering issues
        try {
          const validated: Range<Decoration>[] = []
          const iter = decorations.iter()
          while (iter.value) {
            if (iter.from >= 0 && iter.to <= docLength && iter.from < iter.to) {
              validated.push(iter.value.range(iter.from, iter.to))
            }
            iter.next()
          }
          return Decoration.set(validated, true)
        } catch {
          return Decoration.none
        }
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.decorations = this.buildDecorations(update.view, language)
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  )
}
