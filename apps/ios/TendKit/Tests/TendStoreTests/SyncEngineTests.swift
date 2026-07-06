// SPDX-License-Identifier: MIT WITH Commons-Clause
import XCTest
@testable import TendStore
import TendModel
import TendAPI
import TendSync

/// A configurable ``TendAPIClient`` double. Only the methods the sync engine uses are
/// scriptable; the rest throw so an unexpected call is loud.
final class FakeAPI: TendAPIClient, @unchecked Sendable {
    var onUpdateJournal: (@Sendable (String, [BlockPayload], Int?) throws -> Page)?
    var onGetJournal: (@Sendable (String) throws -> Page)?
    private(set) var updateJournalCalls = 0

    private func notImpl<T>() throws -> T { throw TendAPIError.http(status: 501, body: nil) }

    func updateJournal(date: String, blocks: [BlockPayload], version: Int?) async throws -> Page {
        updateJournalCalls += 1
        guard let onUpdateJournal else { return try notImpl() }
        return try onUpdateJournal(date, blocks, version)
    }
    func getJournal(date: String) async throws -> Page {
        guard let onGetJournal else { return try notImpl() }
        return try onGetJournal(date)
    }

    // Unused endpoints.
    func whoami() async throws -> WhoamiResponse { try notImpl() }
    func listPages() async throws -> [PageMeta] { try notImpl() }
    func getPage(name: String) async throws -> Page { try notImpl() }
    func createPage(name: String, content: String?) async throws -> Page { try notImpl() }
    func updatePage(name: String, blocks: [BlockPayload], version: Int?) async throws -> Page { try notImpl() }
    func deletePage(name: String) async throws { _ = try notImpl() as Int }
    func backlinks(pageName: String) async throws -> [BacklinkRef] { try notImpl() }
    func listJournals() async throws -> [PageMeta] { try notImpl() }
    func listSheets(contentType: String) async throws -> [PageMeta] { try notImpl() }
    func getSheet(contentType: String, name: String, date: String?) async throws -> Page { try notImpl() }
    func createSheet(contentType: String, name: String, date: String?, content: String?) async throws -> Page { try notImpl() }
    func updateSheet(contentType: String, name: String, blocks: [BlockPayload], version: Int?, date: String?) async throws -> Page { try notImpl() }
    func deleteSheet(contentType: String, name: String, date: String?) async throws { _ = try notImpl() as Int }
    func search(query: String, limit: Int) async throws -> SearchResponse { try notImpl() }
    func listTags() async throws -> [TagInfo] { try notImpl() }
    func listTodos() async throws -> [TaskItem] { try notImpl() }
    func wikilinkTargets() async throws -> [String] { try notImpl() }
    func lookupBlock(uuid: String) async throws -> BlockRef? { try notImpl() }
    func listContentTypes() async throws -> [ContentType] { try notImpl() }
    func updateContentTypes(_ types: [ContentType]) async throws -> [ContentType] { try notImpl() }
    func getTemplate(contentType: String) async throws -> Page { try notImpl() }
    func updateTemplate(contentType: String, blocks: [BlockPayload]) async throws -> Page { try notImpl() }
    func getUserPrefs() async throws -> [String: JSONValue] { try notImpl() }
    func saveUserPrefs(_ prefs: [String: JSONValue]) async throws { _ = try notImpl() as Int }
    func getUserState() async throws -> [String: JSONValue] { try notImpl() }
    func saveUserState(_ state: [String: JSONValue]) async throws { _ = try notImpl() as Int }
}

private func journal(_ blocks: [(String, String)], version: Int) -> Page {
    var map: [String: Block] = [:]
    var roots: [String] = []
    for (uuid, content) in blocks {
        map[uuid] = Block(uuid: uuid, content: content)
        roots.append(uuid)
    }
    return Page(
        name: "2026-07-06", title: "2026-07-06", rootBlocks: roots, blocks: map,
        contentType: "journal", isJournal: true, journalDate: "2026-07-06",
        createdAt: "t", modifiedAt: "t", version: version
    )
}

final class SyncEngineTests: XCTestCase {
    private let serverId = "s1"

    /// Seed a store with a clean server copy, then a local edit → dirty with base ancestor.
    private func seedDirty(store: InMemoryPageStore, base: Page, edited: Page) async {
        await store.upsertFromServer(base, serverId: serverId)
        await store.saveLocalEdit(edited, serverId: serverId)
    }

    func testCleanFlushMarksSynced() async throws {
        let store = InMemoryPageStore()
        let base = journal([("a", "one")], version: 1)
        var edited = base; edited.blocks["a"]?.content = "ONE"
        await seedDirty(store: store, base: base, edited: edited)

        let api = FakeAPI()
        api.onUpdateJournal = { _, _, _ in
            var saved = edited; saved.version = 2; return saved
        }

        let engine = SyncEngine(store: store, api: api, serverId: serverId)
        let reports = await engine.flush()

        XCTAssertEqual(reports.map(\.outcome), [.saved])
        let stored = await store.loadPage(serverId: serverId, contentType: "journal", name: "2026-07-06")
        XCTAssertEqual(stored?.dirty, false)
        XCTAssertEqual(stored?.local.version, 2)
    }

    func testConflictWithDisjointRemoteEditAutoMergesAndSaves() async throws {
        let store = InMemoryPageStore()
        let base = journal([("a", "one"), ("b", "two")], version: 1)
        var mine = base; mine.blocks["a"]?.content = "MINE-A"
        await seedDirty(store: store, base: base, edited: mine)

        // Server changed a *different* block; version moved to 2.
        var theirs = base; theirs.blocks["b"]?.content = "THEIRS-B"; theirs.version = 2

        let api = FakeAPI()
        api.onUpdateJournal = { _, _, version in
            if api.updateJournalCalls == 1 {
                throw VersionConflictError(message: "stale", currentVersion: 2)
            }
            // Second call is the merged retry at the server's version.
            XCTAssertEqual(version, 2)
            var saved = theirs; saved.blocks["a"]?.content = "MINE-A"; saved.version = 3
            return saved
        }
        api.onGetJournal = { _ in theirs }

        let engine = SyncEngine(store: store, api: api, serverId: serverId)
        let reports = await engine.flush()

        XCTAssertEqual(reports.map(\.outcome), [.saved])
        XCTAssertEqual(api.updateJournalCalls, 2)
        let stored = await store.loadPage(serverId: serverId, contentType: "journal", name: "2026-07-06")
        XCTAssertEqual(stored?.dirty, false)
        XCTAssertEqual(stored?.local.version, 3)
    }

    func testUnresolvableConflictSurfacedAndStaysDirty() async throws {
        let store = InMemoryPageStore()
        let base = journal([("a", "one")], version: 1)
        var mine = base; mine.blocks["a"]?.content = "MINE"
        await seedDirty(store: store, base: base, edited: mine)

        var theirs = base; theirs.blocks["a"]?.content = "THEIRS"; theirs.version = 2

        let api = FakeAPI()
        api.onUpdateJournal = { _, _, _ in
            throw VersionConflictError(message: "stale", currentVersion: 2)
        }
        api.onGetJournal = { _ in theirs }

        let engine = SyncEngine(store: store, api: api, serverId: serverId)
        let reports = await engine.flush()

        guard case .conflict(let result) = reports.first?.outcome else {
            return XCTFail("expected conflict outcome, got \(String(describing: reports.first?.outcome))")
        }
        XCTAssertTrue(result.conflicts.contains { $0.uuid == "a" && $0.kind == .contentDivergence })
        // Page must remain dirty so the edit isn't lost before resolution.
        let stored = await store.loadPage(serverId: serverId, contentType: "journal", name: "2026-07-06")
        XCTAssertEqual(stored?.dirty, true)
    }
}
