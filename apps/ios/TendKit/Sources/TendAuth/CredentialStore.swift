// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation

/// Secure storage for per-server credentials (the Authelia session cookies and last-known
/// username). Behind a protocol so the app uses the Keychain in production and an in-memory
/// double in tests/previews. Scoped by `serverId` (a ``ServerProfile`` id).
public protocol CredentialStore: Sendable {
    func saveCookies(_ cookies: [StoredCookie], serverId: String) throws
    func loadCookies(serverId: String) throws -> [StoredCookie]
    func deleteCookies(serverId: String) throws
    func saveUsername(_ username: String?, serverId: String) throws
    func loadUsername(serverId: String) throws -> String?
}

/// Non-persistent ``CredentialStore`` for tests and previews. Thread-safe via a lock.
public final class InMemoryCredentialStore: CredentialStore, @unchecked Sendable {
    private let lock = NSLock()
    private var cookies: [String: [StoredCookie]] = [:]
    private var usernames: [String: String] = [:]

    public init() {}

    private func sync<T>(_ body: () -> T) -> T {
        lock.lock(); defer { lock.unlock() }
        return body()
    }

    public func saveCookies(_ cookies: [StoredCookie], serverId: String) {
        sync { self.cookies[serverId] = cookies }
    }
    public func loadCookies(serverId: String) -> [StoredCookie] {
        sync { cookies[serverId] ?? [] }
    }
    public func deleteCookies(serverId: String) {
        sync { cookies[serverId] = nil }
    }
    public func saveUsername(_ username: String?, serverId: String) {
        sync { usernames[serverId] = username }
    }
    public func loadUsername(serverId: String) -> String? {
        sync { usernames[serverId] }
    }
}
