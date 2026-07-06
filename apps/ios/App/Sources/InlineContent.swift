// SPDX-License-Identifier: MIT WITH Commons-Clause
import SwiftUI
import TendParser

/// Render a block's markdown content to an `AttributedString` for read-only display, using
/// the shared ``TendParser`` tokenizer so native rendering matches the web editor. (The
/// editable, live-preview version lands with the native editor; this is the reader.)
func renderInline(_ content: String) -> AttributedString {
    var result = AttributedString()
    for token in ContentParser.parse(content) {
        switch token.kind {
        case .text(let s):
            result += AttributedString(s)
        case .bold(let s):
            var a = AttributedString(s); a.inlinePresentationIntent = .stronglyEmphasized; result += a
        case .italic(let s):
            var a = AttributedString(s); a.inlinePresentationIntent = .emphasized; result += a
        case .boldItalic(let s):
            var a = AttributedString(s); a.inlinePresentationIntent = [.stronglyEmphasized, .emphasized]; result += a
        case .strikethrough(let s):
            var a = AttributedString(s); a.strikethroughStyle = .single; result += a
        case .highlight(let s):
            var a = AttributedString(s); a.backgroundColor = .yellow.opacity(0.35); result += a
        case .code(let s):
            var a = AttributedString(s); a.font = .system(.body, design: .monospaced); result += a
        case .tag(let name):
            var a = AttributedString("#\(name)"); a.foregroundColor = .accentColor; result += a
        case .wikilink(_, let display):
            let text = display.split(separator: "/").last.map(String.init) ?? display
            var a = AttributedString(text); a.foregroundColor = .accentColor; a.underlineStyle = .single; result += a
        case .url(let u):
            var a = AttributedString(u); a.foregroundColor = .accentColor; a.underlineStyle = .single; result += a
        case .taskStatus(let keyword, _):
            var a = AttributedString(keyword + " ")
            a.inlinePresentationIntent = .stronglyEmphasized
            a.foregroundColor = .secondary
            result += a
        case .blockReference(let uuid):
            var a = AttributedString("((\(uuid.prefix(8))…))"); a.foregroundColor = .secondary; result += a
        case .headerPrefix:
            break // hidden in display
        }
    }
    return result
}
