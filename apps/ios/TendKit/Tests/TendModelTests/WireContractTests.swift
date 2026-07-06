// SPDX-License-Identifier: MIT WITH Commons-Clause
import XCTest
@testable import TendModel

/// Golden tests pinning the JSON wire contract with the Tend backend. These are the
/// safety net for a client that is authored without a compiler/server in the loop:
/// they fail loudly if a field name or casing drifts from `crates/tend-core` /
/// `packages/web/src/lib/api.ts`.
final class WireContractTests: XCTestCase {
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    // MARK: Responses are camelCase

    func testDecodePageCamelCase() throws {
        let json = """
        {
          "name": "2026-07-06",
          "title": "Monday, July 6, 2026",
          "rootBlocks": ["a1"],
          "blocks": {
            "a1": {
              "uuid": "a1", "content": "Mizzou athletics sponsorship",
              "parentUuid": null, "children": ["b2"],
              "collapsed": false, "properties": {}, "depth": 0
            },
            "b2": {
              "uuid": "b2", "content": "TODO Follow up with Koster",
              "parentUuid": "a1", "children": [],
              "collapsed": false, "properties": {"priority": "high"}, "depth": 1
            }
          },
          "properties": {},
          "contentType": "journal",
          "isJournal": true,
          "journalDate": "2026-07-06",
          "createdAt": "2026-07-06T12:00:00Z",
          "modifiedAt": "2026-07-06T12:34:56Z",
          "version": 7
        }
        """
        let page = try decoder.decode(Page.self, from: Data(json.utf8))
        XCTAssertEqual(page.name, "2026-07-06")
        XCTAssertTrue(page.isJournal)
        XCTAssertEqual(page.journalDate, "2026-07-06")
        XCTAssertEqual(page.version, 7)
        XCTAssertEqual(page.rootBlocks, ["a1"])
        XCTAssertNil(page.blocks["a1"]?.parentUuid)
        XCTAssertEqual(page.blocks["b2"]?.parentUuid, "a1")
        XCTAssertEqual(page.blocks["b2"]?.properties["priority"], "high")

        // Tree order follows rootBlocks then children.
        XCTAssertEqual(page.blocksInOrder.map(\.uuid), ["a1", "b2"])
    }

    func testBlockOmittedParentUuidDecodesNil() throws {
        // parentUuid key absent entirely (not just null) must still decode.
        let json = """
        {"uuid":"x","content":"hi","children":[],"collapsed":false,"properties":{},"depth":0}
        """
        let block = try decoder.decode(Block.self, from: Data(json.utf8))
        XCTAssertNil(block.parentUuid)
    }

    // MARK: Write requests use snake_case parent_uuid

    func testBlockPayloadEncodesSnakeCaseParentUuid() throws {
        let payload = BlockPayload(uuid: "b2", content: "child", parentUuid: "a1")
        let text = String(decoding: try encoder.encode(payload), as: UTF8.self)
        XCTAssertTrue(text.contains("\"parent_uuid\""), "request must use snake_case parent_uuid")
        XCTAssertFalse(text.contains("parentUuid"), "request must NOT use camelCase parentUuid")
    }

    func testBlockPayloadRoundTrips() throws {
        let payload = BlockPayload(
            uuid: "b2", content: "child", parentUuid: "a1",
            children: ["c3"], collapsed: true, properties: ["k": "v"]
        )
        let decoded = try decoder.decode(BlockPayload.self, from: try encoder.encode(payload))
        XCTAssertEqual(decoded, payload)
    }

    func testBlockToPayloadDropsDepthKeepsParent() {
        let block = Block(uuid: "b2", content: "c", parentUuid: "a1", depth: 3)
        XCTAssertEqual(block.payload.uuid, "b2")
        XCTAssertEqual(block.payload.parentUuid, "a1")
    }

    // MARK: Errors

    func testVersionConflictBodyDecodes() throws {
        let json = """
        {"error":"Version mismatch: expected 5, current 6","code":"VERSION_CONFLICT","currentVersion":6}
        """
        let body = try decoder.decode(ApiErrorBody.self, from: Data(json.utf8))
        XCTAssertTrue(body.isVersionConflict)
        XCTAssertEqual(body.currentVersion, 6)
    }

    func testPlainErrorBodyDecodes() throws {
        let body = try decoder.decode(ApiErrorBody.self, from: Data(#"{"error":"Page not found"}"#.utf8))
        XCTAssertFalse(body.isVersionConflict)
        XCTAssertNil(body.currentVersion)
    }

    // MARK: Content type organization enum

    func testOrganizationDecodesDateFoldered() throws {
        let json = """
        {"id":"meeting","name":"Meeting","directory":"meetings","organization":"dateFoldered","template":""}
        """
        let ct = try decoder.decode(ContentType.self, from: Data(json.utf8))
        XCTAssertEqual(ct.organization, .dateFoldered)
    }

    // MARK: Task status parsing (mirrors backend trim_start + keyword prefix)

    func testTaskStatusParse() {
        XCTAssertEqual(TaskStatus.parse("TODO Buy milk")?.status, .todo)
        XCTAssertEqual(TaskStatus.parse("   DOING x")?.status, .doing)
        XCTAssertEqual(TaskStatus.parse("DONE done")?.rest, "done")
        XCTAssertNil(TaskStatus.parse("Regular text"))
        XCTAssertNil(TaskStatus.parse("TODOnospace"))
    }

    func testTaskStatusOpenness() {
        XCTAssertTrue(TaskStatus.todo.isOpen)
        XCTAssertFalse(TaskStatus.done.isOpen)
        XCTAssertFalse(TaskStatus.cancelled.isOpen)
    }
}
