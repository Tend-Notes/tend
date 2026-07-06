// SPDX-License-Identifier: MIT WITH Commons-Clause
import XCTest
@testable import TendAPI
import TendModel
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A scripted transport that records the last request and returns a canned response,
/// so we can assert on request shaping and status mapping without a server.
final class StubTransport: HTTPTransport, @unchecked Sendable {
    var lastRequest: URLRequest?
    private let handler: @Sendable (URLRequest) -> (Int, Data)

    init(_ handler: @escaping @Sendable (URLRequest) -> (Int, Data)) {
        self.handler = handler
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        lastRequest = request
        let (status, data) = handler(request)
        let response = HTTPURLResponse(
            url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil
        )!
        return (data, response)
    }
}

private let base = URL(string: "https://notes.example.com")!

private let samplePageJSON = """
{
  "name": "My Page", "title": "My Page",
  "rootBlocks": ["b"], "blocks": {
    "b": {"uuid":"b","content":"hi","parentUuid":null,"children":[],"collapsed":false,"properties":{},"depth":0}
  },
  "properties": {}, "contentType": "page", "isJournal": false, "journalDate": null,
  "createdAt": "2026-07-06T00:00:00Z", "modifiedAt": "2026-07-06T00:00:00Z", "version": 6
}
"""

final class LiveTendAPIClientTests: XCTestCase {
    func testUpdatePageSendsSnakeCaseBodyAndEncodedPath() async throws {
        let stub = StubTransport { _ in (200, Data(samplePageJSON.utf8)) }
        let client = LiveTendAPIClient(baseURL: base, transport: stub)

        let payload = BlockPayload(uuid: "b", content: "hi", parentUuid: "a")
        let page = try await client.updatePage(name: "My Page", blocks: [payload], version: 5)

        XCTAssertEqual(page.version, 6)
        let req = try XCTUnwrap(stub.lastRequest)
        XCTAssertEqual(req.httpMethod, "PUT")
        XCTAssertEqual(req.url?.absoluteString, "https://notes.example.com/api/v1/pages/My%20Page")

        let body = String(decoding: try XCTUnwrap(req.httpBody), as: UTF8.self)
        XCTAssertTrue(body.contains("\"parent_uuid\""), "write body must use snake_case parent_uuid")
        XCTAssertFalse(body.contains("parentUuid"))
        XCTAssertTrue(body.contains("\"version\":5"))
    }

    func testSlashInNameIsPercentEncoded() async throws {
        let stub = StubTransport { _ in (200, Data(samplePageJSON.utf8)) }
        let client = LiveTendAPIClient(baseURL: base, transport: stub)
        _ = try await client.getSheet(contentType: "person", name: "John/Doe", date: nil)
        XCTAssertEqual(
            stub.lastRequest?.url?.absoluteString,
            "https://notes.example.com/api/v1/sheets/person/John%2FDoe"
        )
    }

    func testSearchQueryEncoding() async throws {
        let stub = StubTransport { _ in (200, Data(#"{"results":[]}"#.utf8)) }
        let client = LiveTendAPIClient(baseURL: base, transport: stub)
        _ = try await client.search(query: "a b", limit: 10)
        let url = try XCTUnwrap(stub.lastRequest?.url?.absoluteString)
        XCTAssertTrue(url.contains("q=a%20b"), url)
        XCTAssertTrue(url.contains("limit=10"), url)
    }

    func testUnauthorizedMapsTo401Error() async throws {
        let stub = StubTransport { _ in (401, Data(#"{"error":"unauthorized"}"#.utf8)) }
        let client = LiveTendAPIClient(baseURL: base, transport: stub)
        do {
            _ = try await client.whoami()
            XCTFail("expected unauthorized")
        } catch TendAPIError.unauthorized {
            // expected
        }
    }

    func testVersionConflictThrowsTypedError() async throws {
        let body = #"{"error":"Version mismatch","code":"VERSION_CONFLICT","currentVersion":6}"#
        let stub = StubTransport { _ in (409, Data(body.utf8)) }
        let client = LiveTendAPIClient(baseURL: base, transport: stub)
        do {
            _ = try await client.updateJournal(date: "2026-07-06", blocks: [], version: 5)
            XCTFail("expected version conflict")
        } catch let error as VersionConflictError {
            XCTAssertEqual(error.currentVersion, 6)
        }
    }

    func testLookupBlockReturnsNilOnMissingOrEncrypted() async throws {
        for status in [403, 404] {
            let stub = StubTransport { _ in (status, Data(#"{"error":"x"}"#.utf8)) }
            let client = LiveTendAPIClient(baseURL: base, transport: stub)
            let ref = try await client.lookupBlock(uuid: "550e8400-e29b-41d4-a716-446655440000")
            XCTAssertNil(ref, "status \(status) should be treated as no preview")
        }
    }

    func testTodosUnwrapsTaskList() async throws {
        let body = #"{"tasks":[{"uuid":"t1","status":"TODO","content":"x","pageName":"p","pageTitle":"P","isJournal":false,"journalDate":null,"dueDate":null,"startDate":null,"priority":null}]}"#
        let stub = StubTransport { _ in (200, Data(body.utf8)) }
        let client = LiveTendAPIClient(baseURL: base, transport: stub)
        let todos = try await client.listTodos()
        XCTAssertEqual(todos.map(\.uuid), ["t1"])
    }
}
