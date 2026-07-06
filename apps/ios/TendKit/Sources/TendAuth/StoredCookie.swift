// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking // HTTPCookie lives here on Linux
#endif

/// A `Codable` snapshot of the fields we persist from an `HTTPCookie` — enough to
/// reconstruct the Authelia session cookie for later requests. (HTTPOnly is intentionally
/// not round-tripped: `HTTPCookie(properties:)` has no key for it, and it doesn't affect
/// how we attach the cookie to `URLSession`.)
public struct StoredCookie: Codable, Equatable, Sendable {
    public var name: String
    public var value: String
    public var domain: String
    public var path: String
    public var isSecure: Bool
    public var expiresDate: Date?

    public init(name: String, value: String, domain: String, path: String, isSecure: Bool, expiresDate: Date?) {
        self.name = name
        self.value = value
        self.domain = domain
        self.path = path
        self.isSecure = isSecure
        self.expiresDate = expiresDate
    }

    public init(_ cookie: HTTPCookie) {
        self.name = cookie.name
        self.value = cookie.value
        self.domain = cookie.domain
        self.path = cookie.path
        self.isSecure = cookie.isSecure
        self.expiresDate = cookie.expiresDate
    }

    /// Rebuild an `HTTPCookie`, or `nil` if the fields don't form a valid cookie.
    public var httpCookie: HTTPCookie? {
        var props: [HTTPCookiePropertyKey: Any] = [
            .name: name,
            .value: value,
            .domain: domain,
            .path: path,
        ]
        if isSecure { props[.secure] = "TRUE" }
        if let expiresDate { props[.expires] = expiresDate }
        return HTTPCookie(properties: props)
    }

    /// Whether the cookie has expired relative to `now`.
    public func isExpired(now: Date) -> Bool {
        guard let expiresDate else { return false } // session cookie — no explicit expiry
        return expiresDate <= now
    }
}
