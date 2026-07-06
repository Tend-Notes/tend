// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation

/// The kind of a parsed inline token. Mirrors `ContentTokenData` in
/// `packages/web/src/components/editor/contentRenderer.ts`.
public enum ContentTokenKind: Equatable, Sendable {
    case text(String)
    case bold(String)
    case italic(String)
    case boldItalic(String)
    case strikethrough(String)
    case highlight(String)
    case code(String)
    case tag(name: String)
    case wikilink(target: String, display: String)
    case url(String)
    case taskStatus(keyword: String, color: String)
    case blockReference(uuid: String)
    case headerPrefix(level: Int)
}

/// Source span attached to every token (ported verbatim from the web `TokenSpan`).
///
/// All offsets/lengths are **UTF-16 code units** — the same unit JavaScript strings
/// use — so caret mapping stays identical to the web editor. The token's full source
/// range is `srcFrom ..< srcFrom+srcLen`; its visible (rendered) text is the source
/// substring `srcFrom+lead ..< srcFrom+lead+renderedLen`. A delimiter's width lives in
/// `lead` (leading) and `srcLen - lead - renderedLen` (trailing). Zero-width rendered
/// tokens (a header prefix) have `renderedLen == 0`.
public struct TokenSpan: Equatable, Sendable {
    public var srcFrom: Int
    public var srcLen: Int
    public var lead: Int
    public var renderedLen: Int

    public init(srcFrom: Int, srcLen: Int, lead: Int, renderedLen: Int) {
        self.srcFrom = srcFrom
        self.srcLen = srcLen
        self.lead = lead
        self.renderedLen = renderedLen
    }
}

/// A parsed token: its kind plus where it came from in the source.
public struct ContentToken: Equatable, Sendable {
    public var kind: ContentTokenKind
    public var span: TokenSpan

    public init(kind: ContentTokenKind, span: TokenSpan) {
        self.kind = kind
        self.span = span
    }
}
