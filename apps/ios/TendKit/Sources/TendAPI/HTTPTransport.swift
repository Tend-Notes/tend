// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking // Linux URLSession lives here (lets the client compile off-device)
#endif

/// The minimal networking seam the API client depends on, so the client is testable with
/// a stub transport and swappable for the real `URLSession`.
public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

/// Live transport over `URLSession`. In production the session is configured with a shared
/// `HTTPCookieStorage` that `TendAuth` populates with the Authelia session cookie, so
/// requests are authenticated automatically without the client touching headers.
public struct URLSessionTransport: HTTPTransport {
    private let session: URLSession

    public init(session: URLSession) {
        self.session = session
    }

    /// Build a session that persists cookies in the given storage and never caches
    /// response bodies (notes should not linger in an on-disk URL cache).
    public static func makeSession(cookieStorage: HTTPCookieStorage) -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = cookieStorage
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }

    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw TendAPIError.nonHTTPResponse
        }
        return (data, http)
    }
}
