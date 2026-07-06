// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation

/// A configured Tend server the app can talk to — the public reverse-proxy origin plus a
/// stable local id used to scope cached data (``PageStore``) and stored credentials
/// (Keychain). Supports multiple servers / switching. The session cookie and username are
/// held in the Keychain keyed by `id`, never in this value.
public struct ServerProfile: Codable, Equatable, Identifiable, Sendable {
    /// Stable local identifier (a generated UUID string), used as the data/credential scope.
    public var id: String
    /// User-facing label (defaults to the host).
    public var name: String
    /// The server origin, e.g. `https://notes.example.com`.
    public var baseURL: URL
    /// Last-known authenticated username (from `/whoami`), for display; source of truth is
    /// still the live session.
    public var username: String?

    public init(id: String, name: String, baseURL: URL, username: String? = nil) {
        self.id = id
        self.name = name
        self.baseURL = baseURL
        self.username = username
    }
}
