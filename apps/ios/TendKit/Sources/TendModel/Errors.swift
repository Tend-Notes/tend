// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation

/// The JSON body the backend returns on error (`crates/tend-server/src/error.rs`):
/// always an `error` string, plus `code` and `currentVersion` on a version conflict.
public struct ApiErrorBody: Codable, Equatable, Sendable {
    public var error: String
    public var code: String?
    public var currentVersion: Int?

    public init(error: String, code: String? = nil, currentVersion: Int? = nil) {
        self.error = error
        self.code = code
        self.currentVersion = currentVersion
    }

    /// The sentinel `code` for a `409` optimistic-concurrency failure.
    public static let versionConflictCode = "VERSION_CONFLICT"

    /// Whether this body represents a version conflict.
    public var isVersionConflict: Bool { code == Self.versionConflictCode }
}

/// Raised when a write is rejected because the page moved on since we loaded it
/// (`409 VERSION_CONFLICT`). `currentVersion` is the server's now-current version, which
/// the sync engine uses to re-fetch, merge, and retry.
public struct VersionConflictError: Error, Equatable, Sendable {
    public var message: String
    public var currentVersion: Int
    public init(message: String, currentVersion: Int) {
        self.message = message
        self.currentVersion = currentVersion
    }
}
