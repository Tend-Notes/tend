// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation
import TendModel

/// `URLSession`-backed implementation of ``TendAPIClient``. Authentication is implicit:
/// the transport's session carries the Authelia session cookie, so the proxy injects
/// `Remote-User` and the backend responds — this client never sets auth headers itself.
public struct LiveTendAPIClient: TendAPIClient {
    private let route: APIRoute
    private let transport: HTTPTransport

    // Computed (not stored) so the struct stays `Sendable` — JSONDecoder/JSONEncoder are
    // non-Sendable reference types. They're cheap to create per call and never shared.
    private var decoder: JSONDecoder { JSONDecoder() }
    private var encoder: JSONEncoder { JSONEncoder() }

    public init(baseURL: URL, transport: HTTPTransport) {
        self.route = APIRoute(baseURL: baseURL)
        self.transport = transport
    }

    // MARK: - Request plumbing

    private func makeRequest(
        _ method: String,
        _ path: String,
        query: [(name: String, value: String)] = [],
        body: Data? = nil
    ) throws -> URLRequest {
        guard let url = route.url(path, query: query) else { throw TendAPIError.invalidURL }
        var req = URLRequest(url: url)
        req.httpMethod = method
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        return req
    }

    /// Send a request and validate the status. On 2xx returns the body data. Maps 401 →
    /// `.unauthorized`, 409 `VERSION_CONFLICT` → ``VersionConflictError``, else `.http`.
    @discardableResult
    private func send(_ request: URLRequest) async throws -> Data {
        let data: Data
        let response: HTTPURLResponse
        do {
            (data, response) = try await transport.send(request)
        } catch {
            throw TendAPIError.transport(error)
        }

        switch response.statusCode {
        case 200...299:
            return data
        case 401:
            throw TendAPIError.unauthorized
        default:
            let body = try? decoder.decode(ApiErrorBody.self, from: data)
            if response.statusCode == 409, let body, body.isVersionConflict {
                throw VersionConflictError(
                    message: body.error,
                    currentVersion: body.currentVersion ?? 0
                )
            }
            throw TendAPIError.http(status: response.statusCode, body: body)
        }
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw TendAPIError.decoding(error)
        }
    }

    private func get<T: Decodable>(_ path: String, query: [(name: String, value: String)] = []) async throws -> T {
        let data = try await send(try makeRequest("GET", path, query: query))
        return try decode(T.self, from: data)
    }

    private func encode<T: Encodable>(_ value: T) throws -> Data {
        do {
            return try encoder.encode(value)
        } catch {
            throw TendAPIError.decoding(error)
        }
    }

    // MARK: - Identity

    public func whoami() async throws -> WhoamiResponse {
        try await get("/whoami")
    }

    // MARK: - Pages

    public func listPages() async throws -> [PageMeta] { try await get("/pages") }

    public func getPage(name: String) async throws -> Page {
        try await get("/pages/\(name.uriComponentEncoded)")
    }

    public func createPage(name: String, content: String?) async throws -> Page {
        let body = try encode(CreatePageRequest(name: name, content: content))
        let data = try await send(try makeRequest("POST", "/pages", body: body))
        return try decode(Page.self, from: data)
    }

    public func updatePage(name: String, blocks: [BlockPayload], version: Int?) async throws -> Page {
        let body = try encode(UpdatePageRequest(blocks: blocks, version: version))
        let data = try await send(try makeRequest("PUT", "/pages/\(name.uriComponentEncoded)", body: body))
        return try decode(Page.self, from: data)
    }

    public func deletePage(name: String) async throws {
        try await send(try makeRequest("DELETE", "/pages/\(name.uriComponentEncoded)"))
    }

    public func backlinks(pageName: String) async throws -> [BacklinkRef] {
        try await get("/pages/\(pageName.uriComponentEncoded)/backlinks")
    }

    // MARK: - Journals

    public func listJournals() async throws -> [PageMeta] { try await get("/journals") }

    public func getJournal(date: String) async throws -> Page {
        // Dates are `YYYY-MM-DD` (no reserved chars) but encode for safety/consistency.
        try await get("/journals/\(date.uriComponentEncoded)")
    }

    public func updateJournal(date: String, blocks: [BlockPayload], version: Int?) async throws -> Page {
        let body = try encode(UpdatePageRequest(blocks: blocks, version: version))
        let data = try await send(try makeRequest("PUT", "/journals/\(date.uriComponentEncoded)", body: body))
        return try decode(Page.self, from: data)
    }

    // MARK: - Sheets

    public func listSheets(contentType: String) async throws -> [PageMeta] {
        try await get("/sheets/\(contentType.uriComponentEncoded)")
    }

    public func getSheet(contentType: String, name: String, date: String?) async throws -> Page {
        try await get(
            "/sheets/\(contentType.uriComponentEncoded)/\(name.uriComponentEncoded)",
            query: dateQuery(date)
        )
    }

    public func createSheet(contentType: String, name: String, date: String?, content: String?) async throws -> Page {
        let body = try encode(CreateSheetRequest(name: name, date: date, content: content))
        let data = try await send(try makeRequest("POST", "/sheets/\(contentType.uriComponentEncoded)", body: body))
        return try decode(Page.self, from: data)
    }

    public func updateSheet(contentType: String, name: String, blocks: [BlockPayload], version: Int?, date: String?) async throws -> Page {
        let body = try encode(UpdatePageRequest(blocks: blocks, version: version))
        let data = try await send(try makeRequest(
            "PUT",
            "/sheets/\(contentType.uriComponentEncoded)/\(name.uriComponentEncoded)",
            query: dateQuery(date),
            body: body
        ))
        return try decode(Page.self, from: data)
    }

    public func deleteSheet(contentType: String, name: String, date: String?) async throws {
        try await send(try makeRequest(
            "DELETE",
            "/sheets/\(contentType.uriComponentEncoded)/\(name.uriComponentEncoded)",
            query: dateQuery(date)
        ))
    }

    private func dateQuery(_ date: String?) -> [(name: String, value: String)] {
        date.map { [("date", $0)] } ?? []
    }

    // MARK: - Discovery

    public func search(query: String, limit: Int) async throws -> SearchResponse {
        try await get("/search", query: [("q", query), ("limit", String(limit))])
    }

    public func listTags() async throws -> [TagInfo] { try await get("/tags") }

    public func listTodos() async throws -> [TaskItem] {
        let list: TaskList = try await get("/todos")
        return list.tasks
    }

    public func wikilinkTargets() async throws -> [String] {
        struct Wrapper: Decodable { let targets: [String] }
        let w: Wrapper = try await get("/links/wikilink-targets")
        return w.targets
    }

    public func lookupBlock(uuid: String) async throws -> BlockRef? {
        // 404 (missing) and 403 (encrypted garden) both mean "no preview available".
        let request = try makeRequest("GET", "/blocks/\(uuid.uriComponentEncoded)")
        let data: Data
        let response: HTTPURLResponse
        do {
            (data, response) = try await transport.send(request)
        } catch {
            throw TendAPIError.transport(error)
        }
        switch response.statusCode {
        case 200...299: return try decode(BlockRef.self, from: data)
        case 403, 404: return nil
        case 401: throw TendAPIError.unauthorized
        default: throw TendAPIError.http(status: response.statusCode, body: try? decoder.decode(ApiErrorBody.self, from: data))
        }
    }

    // MARK: - Content types & templates

    public func listContentTypes() async throws -> [ContentType] { try await get("/content-types") }

    public func updateContentTypes(_ types: [ContentType]) async throws -> [ContentType] {
        struct Body: Encodable { let content_types: [ContentType] }
        let body = try encode(Body(content_types: types))
        let data = try await send(try makeRequest("PUT", "/content-types", body: body))
        return try decode([ContentType].self, from: data)
    }

    public func getTemplate(contentType: String) async throws -> Page {
        try await get("/templates/\(contentType.uriComponentEncoded)")
    }

    public func updateTemplate(contentType: String, blocks: [BlockPayload]) async throws -> Page {
        struct Body: Encodable { let blocks: [BlockPayload] }
        let body = try encode(Body(blocks: blocks))
        let data = try await send(try makeRequest("PUT", "/templates/\(contentType.uriComponentEncoded)", body: body))
        return try decode(Page.self, from: data)
    }

    // MARK: - Per-user opaque state

    public func getUserPrefs() async throws -> [String: JSONValue] { try await get("/user/prefs") }

    public func saveUserPrefs(_ prefs: [String: JSONValue]) async throws {
        try await send(try makeRequest("PUT", "/user/prefs", body: try encode(prefs)))
    }

    public func getUserState() async throws -> [String: JSONValue] { try await get("/user/state") }

    public func saveUserState(_ state: [String: JSONValue]) async throws {
        try await send(try makeRequest("PUT", "/user/state", body: try encode(state)))
    }
}
