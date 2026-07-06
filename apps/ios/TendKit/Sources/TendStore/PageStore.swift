// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation
import TendModel

/// A locally-stored page: the current local copy (`local`, which may contain unsynced
/// edits), the last-synced server snapshot (`base`, the common ancestor for three-way
/// merge), and whether local edits are pending (`dirty`).
public struct StoredPage: Sendable, Equatable {
    public var local: Page
    public var base: Page?
    public var dirty: Bool

    public init(local: Page, base: Page?, dirty: Bool) {
        self.local = local
        self.base = base
        self.dirty = dirty
    }

    /// Listing metadata derived from the local copy.
    public var meta: PageMeta {
        PageMeta(
            name: local.name, title: local.title, contentType: local.contentType,
            isJournal: local.isJournal, journalDate: local.journalDate,
            blockCount: local.blocks.count, createdAt: local.createdAt, modifiedAt: local.modifiedAt
        )
    }
}

/// The offline-first local store, behind a protocol so the sync engine and features depend
/// on the abstraction (real impl: GRDB; tests/previews: in-memory). All pages are scoped to
/// a `serverId` (a configured server profile) for multi-server isolation.
///
/// Identity is `(serverId, contentType, name)`. Journals use `contentType == "journal"` and
/// their `name` is the `YYYY-MM-DD` date.
public protocol PageStore: Sendable {
    /// Store an authoritative server copy. If the local copy has unsynced edits (`dirty`),
    /// this is a no-op — the pending edits are preserved and reconciled on the next flush,
    /// so `base` (the merge ancestor) is never clobbered by a mid-edit refresh.
    func upsertFromServer(_ page: Page, serverId: String) async throws

    /// Record a local edit: replaces `local`, marks `dirty`, and preserves the existing
    /// merge ancestor (`base`).
    func saveLocalEdit(_ page: Page, serverId: String) async throws

    /// Load a single stored page, or `nil` if not cached.
    func loadPage(serverId: String, contentType: String, name: String) async throws -> StoredPage?

    /// Listing metadata, optionally filtered to one content type.
    func listMetas(serverId: String, contentType: String?) async throws -> [PageMeta]

    /// All pages with unsynced local edits (flush candidates).
    func dirtyPages(serverId: String) async throws -> [StoredPage]

    /// Mark a page synced after a successful write: `local` and `base` both become the
    /// server's saved copy and `dirty` clears.
    func markSynced(serverId: String, saved: Page) async throws

    /// Remove a cached page (e.g. after a confirmed delete).
    func removePage(serverId: String, contentType: String, name: String) async throws
}

public extension PageStore {
    /// Composite identity key used by implementations.
    static func key(serverId: String, contentType: String, name: String) -> String {
        "\(serverId)\u{1F}\(contentType)\u{1F}\(name)"
    }
}
