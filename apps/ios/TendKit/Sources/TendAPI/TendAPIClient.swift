// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation
import TendModel

/// The Tend HTTP API, as a protocol so features depend on the abstraction and tests can
/// substitute a stub. Method names/shapes mirror `packages/web/src/lib/api.ts`.
///
/// Writes (`update…`) throw ``TendModel/VersionConflictError`` on `409`; any call may throw
/// ``TendAPIError/unauthorized`` on `401` (cue to re-run the Authelia login).
public protocol TendAPIClient: Sendable {
    // Identity
    func whoami() async throws -> WhoamiResponse

    // Pages
    func listPages() async throws -> [PageMeta]
    func getPage(name: String) async throws -> Page
    func createPage(name: String, content: String?) async throws -> Page
    func updatePage(name: String, blocks: [BlockPayload], version: Int?) async throws -> Page
    func deletePage(name: String) async throws
    func backlinks(pageName: String) async throws -> [BacklinkRef]

    // Journals
    func listJournals() async throws -> [PageMeta]
    func getJournal(date: String) async throws -> Page
    func updateJournal(date: String, blocks: [BlockPayload], version: Int?) async throws -> Page

    // Sheets (custom content types)
    func listSheets(contentType: String) async throws -> [PageMeta]
    func getSheet(contentType: String, name: String, date: String?) async throws -> Page
    func createSheet(contentType: String, name: String, date: String?, content: String?) async throws -> Page
    func updateSheet(contentType: String, name: String, blocks: [BlockPayload], version: Int?, date: String?) async throws -> Page
    func deleteSheet(contentType: String, name: String, date: String?) async throws

    // Discovery
    func search(query: String, limit: Int) async throws -> SearchResponse
    func listTags() async throws -> [TagInfo]
    func listTodos() async throws -> [TaskItem]
    func wikilinkTargets() async throws -> [String]
    func lookupBlock(uuid: String) async throws -> BlockRef?

    // Content types & templates
    func listContentTypes() async throws -> [ContentType]
    func updateContentTypes(_ types: [ContentType]) async throws -> [ContentType]
    func getTemplate(contentType: String) async throws -> Page
    func updateTemplate(contentType: String, blocks: [BlockPayload]) async throws -> Page

    // Per-user opaque state
    func getUserPrefs() async throws -> [String: JSONValue]
    func saveUserPrefs(_ prefs: [String: JSONValue]) async throws
    func getUserState() async throws -> [String: JSONValue]
    func saveUserState(_ state: [String: JSONValue]) async throws
}
