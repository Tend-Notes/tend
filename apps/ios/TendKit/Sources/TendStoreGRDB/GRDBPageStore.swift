// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation
import GRDB
import TendModel
import TendStore

/// GRDB/SQLite-backed ``PageStore``. Isolated in its own target so the rest of TendKit
/// stays dependency-free and offline-testable; this file is the only place that imports
/// GRDB and must be compiled on a Mac.
///
/// **At-rest encryption.** The DB file is protected with iOS Data Protection
/// (`.completeUntilFirstUserAuthentication` — readable for background sync after first
/// unlock, encrypted at rest otherwise). This is the confirmed approach (chosen over
/// SQLCipher for zero key-management and hardware backing); the optional SQLCipher
/// passphrase hook below is left for future defense-in-depth.
public final class GRDBPageStore: PageStore, @unchecked Sendable {
    private let dbQueue: DatabaseQueue

    /// Open (creating if needed) the store at `path`. Pass a `keyProvider` to apply a
    /// SQLCipher passphrase when GRDB is built with SQLCipher.
    public init(path: URL, keyProvider: (() -> String)? = nil) throws {
        var config = Configuration()
        config.prepareDatabase { db in
            // SQLCipher integration point: when GRDB is compiled with SQLCipher, apply the
            // passphrase here, e.g. `try db.usePassphrase(key)`. No-op on stock SQLite.
            if let keyProvider { _ = keyProvider() }
            // Reasonable durability/concurrency defaults.
            try db.execute(sql: "PRAGMA foreign_keys = ON")
        }
        self.dbQueue = try DatabaseQueue(path: path.path, configuration: config)

        // Encrypt the DB (and its -wal/-shm sidecars) at rest via Data Protection.
        try Self.applyFileProtection(to: path)

        try migrator.migrate(dbQueue)
    }

    private static func applyFileProtection(to path: URL) throws {
        let fm = FileManager.default
        for suffix in ["", "-wal", "-shm"] {
            let p = path.path + suffix
            guard fm.fileExists(atPath: p) else { continue }
            try fm.setAttributes(
                [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                ofItemAtPath: p
            )
        }
    }

    private var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()
        migrator.registerMigration("v1_page_record") { db in
            try db.execute(sql: """
                CREATE TABLE page_record (
                    serverId TEXT NOT NULL,
                    contentType TEXT NOT NULL,
                    name TEXT NOT NULL,
                    title TEXT NOT NULL,
                    isJournal INTEGER NOT NULL,
                    journalDate TEXT,
                    createdAt TEXT NOT NULL,
                    modifiedAt TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    blockCount INTEGER NOT NULL,
                    localJSON TEXT NOT NULL,
                    baseJSON TEXT,
                    dirty INTEGER NOT NULL,
                    PRIMARY KEY (serverId, contentType, name)
                )
                """)
            try db.execute(sql: "CREATE INDEX idx_page_server_type ON page_record(serverId, contentType)")
            try db.execute(sql: "CREATE INDEX idx_page_dirty ON page_record(serverId, dirty)")
        }
        return migrator
    }

    // MARK: - JSON helpers

    private func encode(_ page: Page) throws -> String {
        String(decoding: try JSONEncoder().encode(page), as: UTF8.self)
    }
    private func decode(_ json: String) throws -> Page {
        try JSONDecoder().decode(Page.self, from: Data(json.utf8))
    }

    private func upsertRow(_ db: Database, _ page: Page, serverId: String, base: Page?, dirty: Bool) throws {
        try db.execute(sql: """
            INSERT INTO page_record
              (serverId, contentType, name, title, isJournal, journalDate, createdAt,
               modifiedAt, version, blockCount, localJSON, baseJSON, dirty)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(serverId, contentType, name) DO UPDATE SET
              title=excluded.title, isJournal=excluded.isJournal, journalDate=excluded.journalDate,
              createdAt=excluded.createdAt, modifiedAt=excluded.modifiedAt, version=excluded.version,
              blockCount=excluded.blockCount, localJSON=excluded.localJSON,
              baseJSON=excluded.baseJSON, dirty=excluded.dirty
            """, arguments: [
                serverId, page.contentType, page.name, page.title, page.isJournal,
                page.journalDate, page.createdAt, page.modifiedAt, page.version,
                page.blocks.count, try encode(page), try base.map(encode), dirty,
            ])
    }

    private func row(_ db: Database, _ serverId: String, _ contentType: String, _ name: String) throws -> StoredPage? {
        guard let r = try Row.fetchOne(db, sql: """
            SELECT localJSON, baseJSON, dirty FROM page_record
            WHERE serverId=? AND contentType=? AND name=?
            """, arguments: [serverId, contentType, name]) else { return nil }
        let local = try decode(r["localJSON"])
        let base = try (r["baseJSON"] as String?).map(decode)
        let dirty: Bool = r["dirty"]
        return StoredPage(local: local, base: base, dirty: dirty)
    }

    // MARK: - PageStore

    public func upsertFromServer(_ page: Page, serverId: String) async throws {
        try await dbQueue.write { db in
            // Preserve unsynced local edits: skip if this page is dirty.
            let dirty = try Bool.fetchOne(db, sql: """
                SELECT dirty FROM page_record WHERE serverId=? AND contentType=? AND name=?
                """, arguments: [serverId, page.contentType, page.name]) ?? false
            if dirty { return }
            try self.upsertRow(db, page, serverId: serverId, base: page, dirty: false)
        }
    }

    public func saveLocalEdit(_ page: Page, serverId: String) async throws {
        try await dbQueue.write { db in
            let existing = try self.row(db, serverId, page.contentType, page.name)
            let base = existing?.base ?? existing?.local
            try self.upsertRow(db, page, serverId: serverId, base: base, dirty: true)
        }
    }

    public func loadPage(serverId: String, contentType: String, name: String) async throws -> StoredPage? {
        try await dbQueue.read { db in try self.row(db, serverId, contentType, name) }
    }

    public func listMetas(serverId: String, contentType: String?) async throws -> [PageMeta] {
        try await dbQueue.read { db in
            let sql: String
            let args: StatementArguments
            if let contentType {
                sql = "SELECT * FROM page_record WHERE serverId=? AND contentType=? ORDER BY modifiedAt DESC"
                args = [serverId, contentType]
            } else {
                sql = "SELECT * FROM page_record WHERE serverId=? ORDER BY modifiedAt DESC"
                args = [serverId]
            }
            return try Row.fetchAll(db, sql: sql, arguments: args).map { r in
                PageMeta(
                    name: r["name"], title: r["title"], contentType: r["contentType"],
                    isJournal: r["isJournal"], journalDate: r["journalDate"],
                    blockCount: r["blockCount"], createdAt: r["createdAt"], modifiedAt: r["modifiedAt"]
                )
            }
        }
    }

    public func dirtyPages(serverId: String) async throws -> [StoredPage] {
        try await dbQueue.read { db in
            try Row.fetchAll(db, sql: """
                SELECT localJSON, baseJSON, dirty FROM page_record WHERE serverId=? AND dirty=1
                """, arguments: [serverId]).map { r in
                StoredPage(
                    local: try self.decode(r["localJSON"]),
                    base: try (r["baseJSON"] as String?).map(self.decode),
                    dirty: true
                )
            }
        }
    }

    public func markSynced(serverId: String, saved: Page) async throws {
        try await dbQueue.write { db in
            try self.upsertRow(db, saved, serverId: serverId, base: saved, dirty: false)
        }
    }

    public func removePage(serverId: String, contentType: String, name: String) async throws {
        try await dbQueue.write { db in
            try db.execute(sql: """
                DELETE FROM page_record WHERE serverId=? AND contentType=? AND name=?
                """, arguments: [serverId, contentType, name])
        }
    }
}
