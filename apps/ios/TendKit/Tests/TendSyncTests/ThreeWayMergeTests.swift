// SPDX-License-Identifier: MIT WITH Commons-Clause
import XCTest
@testable import TendSync
import TendModel

/// Exercises the conflict-resolution merge that runs after a 409. These are the safety net
/// for the offline-first save path, which cannot be manually tested without two clients.
final class ThreeWayMergeTests: XCTestCase {
    // Build a page from a flat list of (uuid, content) roots for brevity.
    private func page(_ blocks: [(String, String)], version: Int = 1) -> Page {
        var map: [String: Block] = [:]
        var roots: [String] = []
        for (uuid, content) in blocks {
            map[uuid] = Block(uuid: uuid, content: content)
            roots.append(uuid)
        }
        return Page(
            name: "p", title: "p", rootBlocks: roots, blocks: map,
            createdAt: "t", modifiedAt: "t", version: version
        )
    }

    func testLocalOnlyChangeIsTakenCleanly() {
        let base = page([("a", "one"), ("b", "two")])
        var mine = base; mine.blocks["a"]?.content = "ONE"
        let theirs = base
        let result = ThreeWayMerge.merge(base: base, mine: mine, theirs: theirs)
        XCTAssertTrue(result.isClean)
        XCTAssertEqual(result.page.blocks["a"]?.content, "ONE")
    }

    func testRemoteOnlyChangeIsTakenCleanly() {
        let base = page([("a", "one")])
        let mine = base
        var theirs = base; theirs.blocks["a"]?.content = "REMOTE"; theirs.version = 2
        let result = ThreeWayMerge.merge(base: base, mine: mine, theirs: theirs)
        XCTAssertTrue(result.isClean)
        XCTAssertEqual(result.page.blocks["a"]?.content, "REMOTE")
        // Merged page carries the server's current version for the retry PUT.
        XCTAssertEqual(result.page.version, 2)
    }

    func testDisjointEditsOnDifferentBlocksMergeCleanly() {
        let base = page([("a", "one"), ("b", "two")])
        var mine = base; mine.blocks["a"]?.content = "ONE"
        var theirs = base; theirs.blocks["b"]?.content = "TWO"
        let result = ThreeWayMerge.merge(base: base, mine: mine, theirs: theirs)
        XCTAssertTrue(result.isClean)
        XCTAssertEqual(result.page.blocks["a"]?.content, "ONE")
        XCTAssertEqual(result.page.blocks["b"]?.content, "TWO")
    }

    func testSameBlockDivergesIsConflict() {
        let base = page([("a", "one")])
        var mine = base; mine.blocks["a"]?.content = "MINE"
        var theirs = base; theirs.blocks["a"]?.content = "THEIRS"
        let result = ThreeWayMerge.merge(base: base, mine: mine, theirs: theirs)
        XCTAssertFalse(result.isClean)
        XCTAssertTrue(result.conflicts.contains { $0.uuid == "a" && $0.kind == .contentDivergence })
    }

    func testIdenticalEditsCoalesce() {
        let base = page([("a", "one")])
        var mine = base; mine.blocks["a"]?.content = "SAME"
        var theirs = base; theirs.blocks["a"]?.content = "SAME"
        let result = ThreeWayMerge.merge(base: base, mine: mine, theirs: theirs)
        XCTAssertTrue(result.isClean)
        XCTAssertEqual(result.page.blocks["a"]?.content, "SAME")
    }

    func testLocalAddKept() {
        let base = page([("a", "one")])
        var mine = base
        mine.blocks["c"] = Block(uuid: "c", content: "new")
        mine.rootBlocks = ["a", "c"]
        let theirs = base
        let result = ThreeWayMerge.merge(base: base, mine: mine, theirs: theirs)
        XCTAssertTrue(result.isClean)
        XCTAssertNotNil(result.page.blocks["c"])
        XCTAssertEqual(result.page.rootBlocks, ["a", "c"])
    }

    func testCleanRemoteDeleteRemovesBlock() {
        let base = page([("a", "one"), ("b", "two")])
        let mine = base                       // untouched b
        var theirs = base
        theirs.blocks["b"] = nil
        theirs.rootBlocks = ["a"]
        let result = ThreeWayMerge.merge(base: base, mine: mine, theirs: theirs)
        XCTAssertTrue(result.isClean)
        XCTAssertNil(result.page.blocks["b"])
        XCTAssertEqual(result.page.rootBlocks, ["a"])
    }

    func testDeleteModifyIsConflict() {
        let base = page([("a", "one"), ("b", "two")])
        var mine = base; mine.blocks["b"]?.content = "EDITED"   // edited b locally
        var theirs = base
        theirs.blocks["b"] = nil; theirs.rootBlocks = ["a"]      // deleted b remotely
        let result = ThreeWayMerge.merge(base: base, mine: mine, theirs: theirs)
        XCTAssertFalse(result.isClean)
        XCTAssertTrue(result.conflicts.contains { $0.uuid == "b" && $0.kind == .deleteModify })
        // Edited block is kept tentatively so the user doesn't silently lose work.
        XCTAssertEqual(result.page.blocks["b"]?.content, "EDITED")
    }

    func testRootReorderOnOneSideApplies() {
        let base = page([("a", "1"), ("b", "2"), ("c", "3")])
        // mine unchanged; only theirs reorders.
        var theirs = base; theirs.rootBlocks = ["c", "b", "a"]
        let result = ThreeWayMerge.merge(base: base, mine: base, theirs: theirs)
        XCTAssertTrue(result.isClean)
        XCTAssertEqual(result.page.rootBlocks, ["c", "b", "a"])
    }

    func testDivergentRootReorderIsStructuralConflict() {
        let base = page([("a", "1"), ("b", "2"), ("c", "3")])
        var mine = base; mine.rootBlocks = ["b", "a", "c"]
        var theirs = base; theirs.rootBlocks = ["c", "b", "a"]
        let result = ThreeWayMerge.merge(base: base, mine: mine, theirs: theirs)
        XCTAssertFalse(result.isClean)
        XCTAssertTrue(result.conflicts.contains { $0.kind == .structural })
    }
}
