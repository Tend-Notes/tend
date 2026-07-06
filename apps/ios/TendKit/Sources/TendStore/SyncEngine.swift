// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation
import TendModel
import TendAPI
import TendSync

/// The result of trying to flush one page to the server.
public enum FlushOutcome: Sendable, Equatable {
    /// Saved cleanly (first try, or after an automatic clean merge).
    case saved
    /// A conflict that needs user resolution. `MergeResult.page` is the best-effort merge.
    case conflict(MergeResult)
    /// The flush failed (network/other). Carries a description for logging/UI.
    case failed(String)
}

public struct FlushReport: Sendable, Equatable {
    public let contentType: String
    public let name: String
    public let outcome: FlushOutcome
}

/// Drives the offline-first save path: pushes locally-edited pages to the server and, on a
/// `409` version conflict, fetches the server copy and three-way merges against the stored
/// ancestor. Clean merges are re-pushed automatically; genuine conflicts are surfaced for
/// resolution. Timers/debounce and WebSocket invalidation are layered on by the app; this
/// actor owns the correctness-critical push/merge sequence.
public actor SyncEngine {
    private let store: PageStore
    private let api: TendAPIClient
    private let serverId: String

    public init(store: PageStore, api: TendAPIClient, serverId: String) {
        self.store = store
        self.api = api
        self.serverId = serverId
    }

    /// Push every dirty page. Returns one report per attempted page.
    @discardableResult
    public func flush() async -> [FlushReport] {
        let dirty = (try? await store.dirtyPages(serverId: serverId)) ?? []
        var reports: [FlushReport] = []
        for stored in dirty {
            reports.append(await flushOne(stored))
        }
        return reports
    }

    private func flushOne(_ stored: StoredPage) async -> FlushReport {
        let page = stored.local
        func report(_ outcome: FlushOutcome) -> FlushReport {
            FlushReport(contentType: page.contentType, name: page.name, outcome: outcome)
        }

        do {
            let saved = try await push(page, version: page.version)
            try await store.markSynced(serverId: serverId, saved: saved)
            return report(.saved)
        } catch is VersionConflictError {
            return await resolveConflict(page: page, base: stored.base ?? page, report: report)
        } catch {
            return report(.failed(String(describing: error)))
        }
    }

    private func resolveConflict(
        page: Page, base: Page, report: (FlushOutcome) -> FlushReport
    ) async -> FlushReport {
        do {
            let server = try await fetch(page)
            let result = ThreeWayMerge.merge(base: base, mine: page, theirs: server)
            guard result.isClean else {
                return report(.conflict(result))
            }
            let saved = try await push(result.page, version: result.page.version)
            try await store.markSynced(serverId: serverId, saved: saved)
            return report(.saved)
        } catch {
            return report(.failed(String(describing: error)))
        }
    }

    /// Pull a page from the server into the store (no-op overwrite if locally dirty — the
    /// store preserves pending edits).
    @discardableResult
    public func pull(contentType: String, name: String, date: String?) async throws -> Page {
        let ref = PageIdentity(contentType: contentType, name: name, journalDate: date)
        let page = try await fetch(ref)
        try await store.upsertFromServer(page, serverId: serverId)
        return page
    }

    // MARK: - Endpoint dispatch (pages vs journals vs custom sheets)

    private struct PageIdentity {
        let contentType: String
        let name: String
        let journalDate: String?
        var isJournal: Bool { contentType == "journal" }
    }

    private func push(_ page: Page, version: Int?) async throws -> Page {
        let payloads = page.blocksInOrder.map(\.payload)
        if page.isJournal || page.contentType == "journal" {
            return try await api.updateJournal(date: page.name, blocks: payloads, version: version)
        } else if page.contentType == "page" {
            return try await api.updatePage(name: page.name, blocks: payloads, version: version)
        } else {
            return try await api.updateSheet(
                contentType: page.contentType, name: page.name,
                blocks: payloads, version: version, date: page.journalDate
            )
        }
    }

    private func fetch(_ page: Page) async throws -> Page {
        try await fetch(PageIdentity(
            contentType: page.contentType, name: page.name, journalDate: page.journalDate
        ))
    }

    private func fetch(_ id: PageIdentity) async throws -> Page {
        if id.isJournal {
            return try await api.getJournal(date: id.name)
        } else if id.contentType == "page" {
            return try await api.getPage(name: id.name)
        } else {
            return try await api.getSheet(contentType: id.contentType, name: id.name, date: id.journalDate)
        }
    }
}
