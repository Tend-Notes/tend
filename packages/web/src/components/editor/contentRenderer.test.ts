// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// EF-08: caret offset maps are driven by per-token source spans, so they must be
// self-consistent. The core invariant: rendered -> source -> rendered is the
// identity for every rendered offset (source has extra positions inside
// delimiters, so the reverse round-trip is not required to be identity).
import { describe, it, expect } from 'vitest'
import {
  parseContent,
  mapRenderedOffsetToSource,
  mapSourceOffsetToRendered,
} from './contentRenderer'

// The visible text a token contributes, matching what the renderers show.
function renderedText(content: string): string {
  return parseContent(content)
    .map((t) => {
      switch (t.type) {
        case 'text':
        case 'bold':
        case 'italic':
        case 'bolditalic':
        case 'strikethrough':
        case 'highlight':
        case 'code':
          return t.content
        case 'tag':
          return '#' + t.name
        case 'url':
          return t.url
        case 'taskStatus':
          return t.keyword
        case 'blockReference':
          return '((' + t.uuid + '))'
        case 'wikilink': {
          const i = t.display.lastIndexOf('/')
          return i >= 0 ? t.display.slice(i + 1) : t.display
        }
        case 'headerPrefix':
          return ''
      }
    })
    .join('')
}

const CORPUS = [
  'plain text',
  '**bold** and *italic* mix',
  '***all*** ~~strike~~ ==mark== `code`',
  '# Heading text here',
  'TODO buy milk',
  '# TODO nested header task',
  'see [[Odyssey]] tonight',
  'link [[person/John|Johnny]] here',
  'path [[a/b/c]] end',
  'tag #alpha and #beta-two done',
  'go https://example.com/page now',
  'ref ((12345678-1234-1234-1234-123456789abc)) end',
  'emoji 😀 and CJK 日本語 text',
  'adjacent**bold**text',
  '',
  '**edge**',
]

describe('EF-08 offset maps', () => {
  it('rendered -> source -> rendered is the identity for every offset', () => {
    for (const content of CORPUS) {
      const tokens = parseContent(content)
      const rlen = renderedText(content).length
      for (let r = 0; r <= rlen; r++) {
        const src = mapRenderedOffsetToSource(tokens, r)
        const back = mapSourceOffsetToRendered(tokens, src)
        expect(back, `content=${JSON.stringify(content)} r=${r} src=${src}`).toBe(r)
      }
    }
  })

  it('every mapped source offset is within the source string', () => {
    for (const content of CORPUS) {
      const tokens = parseContent(content)
      const rlen = renderedText(content).length
      for (let r = 0; r <= rlen; r++) {
        const src = mapRenderedOffsetToSource(tokens, r)
        expect(src).toBeGreaterThanOrEqual(0)
        expect(src).toBeLessThanOrEqual(content.length)
      }
    }
  })

  it('places the caret inside inline markup, not on the delimiters', () => {
    // "**bold**": rendered "bold". Clicking before 'b' (rendered 0) lands after
    // the opening ** (source index 2); after 'd' (rendered 4) lands before ** (6).
    const bold = parseContent('**bold**')
    expect(mapRenderedOffsetToSource(bold, 0)).toBe(2)
    expect(mapRenderedOffsetToSource(bold, 4)).toBe(6)

    // "`code`": rendered "code"; rendered 0 -> source 1 (after backtick).
    const code = parseContent('`code`')
    expect(mapRenderedOffsetToSource(code, 0)).toBe(1)
    expect(mapRenderedOffsetToSource(code, 4)).toBe(5)
  })

  it('maps the visible text of an aliased/pathed wikilink to its source span', () => {
    // "[[person/John|Johnny]]": visible "Johnny" begins after "[[person/John|".
    // Interior visible characters map onto the matching source character (the
    // exact start offset is a token boundary and belongs to the previous token).
    const src = 'x [[person/John|Johnny]] y'
    const tokens = parseContent(src)
    const rendered = renderedText(src)
    const jIdx = rendered.indexOf('Johnny')
    for (let k = 1; k < 'Johnny'.length; k++) {
      const caret = mapRenderedOffsetToSource(tokens, jIdx + k)
      expect(src[caret], `k=${k}`).toBe('Johnny'[k])
    }
  })

  it('maps the header prefix rendered start onto the first visible character', () => {
    // "# Hello": rendered "Hello"; rendered 0 -> source 2 (the 'H'), not 0.
    const tokens = parseContent('# Hello')
    expect(mapRenderedOffsetToSource(tokens, 0)).toBe(2)
  })

  it('parses a wikilink alias into distinct target and display', () => {
    const [tok] = parseContent('[[a|b]]')
    expect(tok.type).toBe('wikilink')
    if (tok.type === 'wikilink') {
      expect(tok.target).toBe('a')
      expect(tok.display).toBe('b')
    }
  })
})
