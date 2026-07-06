// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation

/// Tokenizer for block content — a faithful Swift port of `parseContent` in
/// `packages/web/src/components/editor/contentRenderer.ts`. It recognizes header and
/// task prefixes, then (left-to-right, earliest-match-wins) block references, bold/
/// italic/bold-italic, strikethrough, highlight, inline code, wiki-links, tags, and URLs.
///
/// Everything runs in UTF-16 space via `NSString`/`NSRegularExpression`, and the source
/// is re-sliced each step exactly like the JS `remaining.slice(...)`, so token spans and
/// caret mapping match the web editor byte-for-byte.
public enum ContentParser {
    // UUID pattern for block references.
    private static let uuidPattern =
        "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"

    /// Task-status keywords across both display sets (matches the web `TASK_KEYWORDS`).
    static let taskKeywords = ["TODO", "DOING", "DONE", "NOW", "LATER", "NEVER"]

    /// Keyword → base16 color slug (matches the web `TASK_KEYWORD_COLORS`).
    static let taskKeywordColors: [String: String] = [
        "TODO": "base-0A",
        "DOING": "base-0D",
        "DONE": "base-0B",
        "NOW": "base-08",
        "LATER": "base-0A",
        "NEVER": "base-03",
    ]

    private static func re(_ pattern: String, _ options: NSRegularExpression.Options = []) -> NSRegularExpression {
        // Patterns are compile-time constants known to be valid.
        // swiftlint:disable:next force_try
        try! NSRegularExpression(pattern: pattern, options: options)
    }

    private enum PatternType {
        case blockReference, boldItalic, bold, italic, strikethrough, highlight, code, wikilink, tag, url
    }

    private struct Pattern {
        let regex: NSRegularExpression
        let type: PatternType
    }

    private static let headerRegex = re("^(#{1,6})\\s")
    private static let taskRegex = re("^(" + taskKeywords.joined(separator: "|") + ")\\s")

    // Order matters — more specific patterns first (mirrors the web `patterns` array).
    private static let patterns: [Pattern] = [
        Pattern(regex: re("\\(\\((" + uuidPattern + ")\\)\\)", .caseInsensitive), type: .blockReference),
        Pattern(regex: re("(\\*\\*\\*|___)(.+?)\\1"), type: .boldItalic),
        Pattern(regex: re("(\\*\\*|__)(.+?)\\1"), type: .bold),
        Pattern(regex: re("(?<![a-zA-Z0-9])([*_])(?![*_\\s])(.+?)(?<![*_\\s])\\1(?![a-zA-Z0-9])"), type: .italic),
        Pattern(regex: re("~~(.+?)~~"), type: .strikethrough),
        Pattern(regex: re("==(.+?)=="), type: .highlight),
        Pattern(regex: re("`([^`]+)`"), type: .code),
        Pattern(regex: re("\\[\\[([^\\]|]+)(?:\\|([^\\]]+))?\\]\\]"), type: .wikilink),
        Pattern(regex: re("(?:^|\\s)(#[a-zA-Z][a-zA-Z0-9_-]*)"), type: .tag),
        Pattern(regex: re("(https?://[^\\s<>\\[\\]*`]+)"), type: .url),
    ]

    /// Parse `content` into inline tokens.
    public static func parse(_ content: String) -> [ContentToken] {
        var tokens: [ContentToken] = []
        var remaining = content as NSString
        var base = 0

        func push(_ kind: ContentTokenKind, _ srcFrom: Int, _ srcLen: Int, _ lead: Int, _ renderedLen: Int) {
            tokens.append(ContentToken(
                kind: kind,
                span: TokenSpan(srcFrom: srcFrom, srcLen: srcLen, lead: lead, renderedLen: renderedLen)
            ))
        }

        func fullRange(_ s: NSString) -> NSRange { NSRange(location: 0, length: s.length) }

        // Header prefix at the very start.
        if let m = headerRegex.firstMatch(in: remaining as String, range: fullRange(remaining)) {
            let whole = m.range.length
            let hashes = m.range(at: 1).length
            push(.headerPrefix(level: hashes), base, whole, whole, 0)
            remaining = remaining.substring(from: whole) as NSString
            base += whole
        }

        // Task keyword at the start (after any header prefix).
        if let m = taskRegex.firstMatch(in: remaining as String, range: fullRange(remaining)) {
            let whole = m.range.length
            let keyword = remaining.substring(with: m.range(at: 1))
            let color = taskKeywordColors[keyword] ?? "base-03"
            push(.taskStatus(keyword: keyword, color: color), base, whole, 0, keyword.utf16Count)
            remaining = remaining.substring(from: whole) as NSString
            base += whole
        }

        while remaining.length > 0 {
            var earliest: (index: Int, match: NSTextCheckingResult, type: PatternType)?
            for pattern in patterns {
                guard let m = pattern.regex.firstMatch(in: remaining as String, range: fullRange(remaining)) else { continue }
                let idx = m.range.location
                if earliest == nil || idx < earliest!.index {
                    earliest = (idx, m, pattern.type)
                }
            }

            guard let hit = earliest else {
                // No more matches — the rest is plain text.
                let rest = remaining as String
                if remaining.length > 0 {
                    push(.text(rest), base, remaining.length, 0, remaining.length)
                }
                break
            }

            let index = hit.index
            let match = hit.match
            if index > 0 {
                let leadingText = remaining.substring(to: index)
                push(.text(leadingText), base, index, 0, index)
            }

            let tokFrom = base + index
            let srcLen = match.range.length
            func group(_ i: Int) -> String? {
                let r = match.range(at: i)
                return r.location == NSNotFound ? nil : remaining.substring(with: r)
            }

            switch hit.type {
            case .blockReference:
                let uuid = group(1) ?? ""
                push(.blockReference(uuid: uuid), tokFrom, srcLen, 0, uuid.utf16Count + 4)
            case .boldItalic:
                let inner = group(2) ?? ""
                push(.boldItalic(inner), tokFrom, srcLen, 3, inner.utf16Count)
            case .bold:
                let inner = group(2) ?? ""
                push(.bold(inner), tokFrom, srcLen, 2, inner.utf16Count)
            case .italic:
                let inner = group(2) ?? ""
                push(.italic(inner), tokFrom, srcLen, 1, inner.utf16Count)
            case .strikethrough:
                let inner = group(1) ?? ""
                push(.strikethrough(inner), tokFrom, srcLen, 2, inner.utf16Count)
            case .highlight:
                let inner = group(1) ?? ""
                push(.highlight(inner), tokFrom, srcLen, 2, inner.utf16Count)
            case .code:
                let inner = group(1) ?? ""
                push(.code(inner), tokFrom, srcLen, 1, inner.utf16Count)
            case .wikilink:
                let target = group(1) ?? ""
                let aliased = group(2)
                let display = aliased ?? target
                let displayNS = display as NSString
                let lastSlash = displayNS.range(of: "/", options: .backwards).location
                let hasSlash = lastSlash != NSNotFound
                let displayText = hasSlash ? displayNS.substring(from: lastSlash + 1) : display
                let displayStartInSrc = aliased != nil ? 2 + target.utf16Count + 1 : 2
                let lead = displayStartInSrc + (hasSlash ? lastSlash + 1 : 0)
                push(.wikilink(target: target, display: display), tokFrom, srcLen, lead, displayText.utf16Count)
            case .tag:
                let whole = remaining.substring(with: match.range)
                let hasLeadingSpace = whole.hasPrefix(" ") || whole.hasPrefix("\t")
                var tagFrom = tokFrom
                if hasLeadingSpace {
                    push(.text(String(whole.first!)), tokFrom, 1, 0, 1)
                    tagFrom = tokFrom + 1
                }
                let hashTag = group(1) ?? "#"
                let name = String((hashTag as NSString).substring(from: 1))
                push(.tag(name: name), tagFrom, name.utf16Count + 1, 0, name.utf16Count + 1)
            case .url:
                let url = group(1) ?? ""
                push(.url(url), tokFrom, srcLen, 0, url.utf16Count)
            }

            let consumed = index + match.range.length
            remaining = remaining.substring(from: consumed) as NSString
            base += consumed
        }

        return tokens
    }
}

extension String {
    /// UTF-16 code-unit count — the unit the parser and caret mapping work in.
    var utf16Count: Int { utf16.count }
}
