// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation

/// Response from `GET /whoami` — the username the reverse proxy injected via the
/// `Remote-User` header after Authelia validated the session cookie. The client uses
/// this to confirm authentication succeeded and to detect a user switch.
public struct WhoamiResponse: Codable, Equatable, Sendable {
    public var username: String
    public init(username: String) { self.username = username }
}
