// SPDX-License-Identifier: MIT WITH Commons-Clause
import XCTest
@testable import TendParser

/// Ports the behavioral expectations of the web `parseContent` so the native renderer
/// tokenizes block content identically. Spans are asserted where they drive caret mapping.
final class ContentParserTests: XCTestCase {
    private func kinds(_ s: String) -> [ContentTokenKind] { ContentParser.parse(s).map(\.kind) }

    func testPlainText() {
        XCTAssertEqual(kinds("just words"), [.text("just words")])
    }

    func testBoldSurroundedByText() {
        let toks = ContentParser.parse("a **b** c")
        XCTAssertEqual(toks.map(\.kind), [.text("a "), .bold("b"), .text(" c")])
        XCTAssertEqual(toks[1].span, TokenSpan(srcFrom: 2, srcLen: 5, lead: 2, renderedLen: 1))
    }

    func testBoldItalicBeatsBold() {
        XCTAssertEqual(kinds("***x***"), [.boldItalic("x")])
    }

    func testItalicUnderscore() {
        let toks = ContentParser.parse("_x_")
        XCTAssertEqual(toks.map(\.kind), [.italic("x")])
        XCTAssertEqual(toks[0].span, TokenSpan(srcFrom: 0, srcLen: 3, lead: 1, renderedLen: 1))
    }

    func testMidWordUnderscoreIsNotItalic() {
        // Lookbehind/ahead guards prevent snake_case from italicizing.
        XCTAssertEqual(kinds("a_b_c"), [.text("a_b_c")])
    }

    func testStrikethroughHighlightCode() {
        XCTAssertEqual(kinds("~~s~~"), [.strikethrough("s")])
        XCTAssertEqual(kinds("==h=="), [.highlight("h")])
        XCTAssertEqual(kinds("`c`"), [.code("c")])
    }

    func testWikilinkPlain() {
        let toks = ContentParser.parse("[[Page]]")
        XCTAssertEqual(toks.map(\.kind), [.wikilink(target: "Page", display: "Page")])
        XCTAssertEqual(toks[0].span, TokenSpan(srcFrom: 0, srcLen: 8, lead: 2, renderedLen: 4))
    }

    func testWikilinkAliasedShowsAliasAfterLastSlash() {
        let toks = ContentParser.parse("[[foo/bar|Disp]]")
        XCTAssertEqual(toks.map(\.kind), [.wikilink(target: "foo/bar", display: "Disp")])
        // Visible text "Disp" begins at source offset 10.
        XCTAssertEqual(toks[0].span, TokenSpan(srcFrom: 0, srcLen: 16, lead: 10, renderedLen: 4))
    }

    func testWikilinkSlashTargetShowsLastSegment() {
        let toks = ContentParser.parse("[[a/b]]")
        XCTAssertEqual(toks.map(\.kind), [.wikilink(target: "a/b", display: "a/b")])
        // Visible "b" begins at source offset 4.
        XCTAssertEqual(toks[0].span, TokenSpan(srcFrom: 0, srcLen: 7, lead: 4, renderedLen: 1))
    }

    func testTagWithLeadingSpaceSplitsWhitespace() {
        let toks = ContentParser.parse("a #foo")
        XCTAssertEqual(toks.map(\.kind), [.text("a"), .text(" "), .tag(name: "foo")])
        XCTAssertEqual(toks[2].span, TokenSpan(srcFrom: 2, srcLen: 4, lead: 0, renderedLen: 4))
    }

    func testTagAtStart() {
        XCTAssertEqual(kinds("#foo bar"), [.tag(name: "foo"), .text(" bar")])
    }

    func testUrlStopsAtFormatting() {
        XCTAssertEqual(kinds("see https://x.com/a done"),
                       [.text("see "), .url("https://x.com/a"), .text(" done")])
    }

    func testHeaderThenTask() {
        let toks = ContentParser.parse("# TODO hi")
        XCTAssertEqual(toks.map(\.kind),
                       [.headerPrefix(level: 1), .taskStatus(keyword: "TODO", color: "base-0A"), .text("hi")])
        XCTAssertEqual(toks[0].span, TokenSpan(srcFrom: 0, srcLen: 2, lead: 2, renderedLen: 0))
        XCTAssertEqual(toks[1].span, TokenSpan(srcFrom: 2, srcLen: 5, lead: 0, renderedLen: 4))
    }

    func testBlockReference() {
        let uuid = "550e8400-e29b-41d4-a716-446655440000"
        let toks = ContentParser.parse("((\(uuid)))")
        XCTAssertEqual(toks.map(\.kind), [.blockReference(uuid: uuid)])
        XCTAssertEqual(toks[0].span, TokenSpan(srcFrom: 0, srcLen: uuid.utf16Count + 4, lead: 0, renderedLen: uuid.utf16Count + 4))
    }
}

/// Confirms caret mapping is a lossless inverse across delimiters.
final class OffsetMappingTests: XCTestCase {
    func testBoldRoundTrip() {
        let toks = ContentParser.parse("**bold**")
        // Rendered 0 → source 2 (start of "bold"); back to 0.
        XCTAssertEqual(OffsetMapping.renderedToSource(toks, 0), 2)
        XCTAssertEqual(OffsetMapping.sourceToRendered(toks, 2), 0)
        // Rendered 4 (end of "bold") → source 6; back to 4.
        XCTAssertEqual(OffsetMapping.renderedToSource(toks, 4), 6)
        XCTAssertEqual(OffsetMapping.sourceToRendered(toks, 6), 4)
    }

    func testHeaderPrefixZeroWidthFallsThrough() {
        let toks = ContentParser.parse("# hi")
        // Rendered 0 must map past the hidden "# " prefix onto the first real char.
        XCTAssertEqual(OffsetMapping.renderedToSource(toks, 0), 2)
    }

    func testSourceInDelimiterClampsToRenderedStart() {
        let toks = ContentParser.parse("**bold**")
        // Source offset 1 (inside leading "**") clamps to rendered start 0.
        XCTAssertEqual(OffsetMapping.sourceToRendered(toks, 1), 0)
    }
}
