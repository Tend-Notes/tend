// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation
import TendModel

/// An in-memory ``PageStore`` for tests and SwiftUI previews — same semantics as the GRDB
/// store, no persistence. An actor so concurrent access is safe.
public actor InMemoryPageStore: PageStore {
    private var pages: [String: StoredPage] = [:]

    public init() {}

    private func key(_ serverId: String, _ contentType: String, _ name: String) -> String {
        Self.key(serverId: serverId, contentType: contentType, name: name)
    }

    public func upsertFromServer(_ page: Page, serverId: String) {
        let k = key(serverId, page.contentType, page.name)
        if pages[k]?.dirty == true { return } // keep local edits; flush reconciles
        pages[k] = StoredPage(local: page, base: page, dirty: false)
    }

    public func saveLocalEdit(_ page: Page, serverId: String) {
        let k = key(serverId, page.contentType, page.name)
        let existing = pages[k]
        let base = existing?.base ?? existing?.local
        pages[k] = StoredPage(local: page, base: base, dirty: true)
    }

    public func loadPage(serverId: String, contentType: String, name: String) -> StoredPage? {
        pages[key(serverId, contentType, name)]
    }

    public func listMetas(serverId: String, contentType: String?) -> [PageMeta] {
        let prefix = serverId + "\u{1F}"
        return pages
            .filter { $0.key.hasPrefix(prefix) }
            .map(\.value)
            .filter { contentType == nil || $0.local.contentType == contentType }
            .map(\.meta)
    }

    public func dirtyPages(serverId: String) -> [StoredPage] {
        let prefix = serverId + "\u{1F}"
        return pages
            .filter { $0.key.hasPrefix(prefix) && $0.value.dirty }
            .map(\.value)
    }

    public func markSynced(serverId: String, saved: Page) {
        let k = key(serverId, saved.contentType, saved.name)
        pages[k] = StoredPage(local: saved, base: saved, dirty: false)
    }

    public func removePage(serverId: String, contentType: String, name: String) {
        pages[key(serverId, contentType, name)] = nil
    }
}
