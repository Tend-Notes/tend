// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation

#if canImport(Security)
import Security

/// Keychain-backed ``CredentialStore``. Cookies and username are stored as JSON under a
/// per-server account, with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` so background
/// sync can read them while the device is locked (after first unlock) but they never sync to
/// iCloud or leave the device. This file compiles only where `Security` is available (Apple
/// platforms); Linux `swift test` uses ``InMemoryCredentialStore``.
public final class KeychainCredentialStore: CredentialStore, @unchecked Sendable {
    private let service: String

    /// - Parameter service: the Keychain service (defaults to the app's bundle-scoped id).
    public init(service: String = "com.tend.ios.credentials") {
        self.service = service
    }

    private func account(_ serverId: String, _ kind: String) -> String { "\(serverId)#\(kind)" }

    public func saveCookies(_ cookies: [StoredCookie], serverId: String) throws {
        try setData(try JSONEncoder().encode(cookies), account: account(serverId, "cookies"))
    }

    public func loadCookies(serverId: String) throws -> [StoredCookie] {
        guard let data = try getData(account: account(serverId, "cookies")) else { return [] }
        return (try? JSONDecoder().decode([StoredCookie].self, from: data)) ?? []
    }

    public func deleteCookies(serverId: String) throws {
        try deleteData(account: account(serverId, "cookies"))
    }

    public func saveUsername(_ username: String?, serverId: String) throws {
        guard let username, let data = username.data(using: .utf8) else {
            try deleteData(account: account(serverId, "username"))
            return
        }
        try setData(data, account: account(serverId, "username"))
    }

    public func loadUsername(serverId: String) throws -> String? {
        guard let data = try getData(account: account(serverId, "username")) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    // MARK: - SecItem plumbing

    private func baseQuery(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    private func setData(_ data: Data, account: String) throws {
        var query = baseQuery(account: account)
        SecItemDelete(query as CFDictionary) // replace semantics
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError.status(status) }
    }

    private func getData(account: String) throws -> Data? {
        var query = baseQuery(account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess: return result as? Data
        case errSecItemNotFound: return nil
        default: throw KeychainError.status(status)
        }
    }

    private func deleteData(account: String) throws {
        let status = SecItemDelete(baseQuery(account: account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.status(status)
        }
    }
}

public enum KeychainError: Error, Equatable {
    case status(OSStatus)
}
#endif
