// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation

/// Builds request URLs against a server's `/api/v1` base. Path segments (page/sheet names,
/// UUIDs, dates) must be passed **already** through ``String/uriComponentEncoded`` so they
/// survive slashes and spaces, matching the web client's `encodeURIComponent` usage.
public struct APIRoute: Sendable {
    /// The server origin, e.g. `https://notes.example.com` (the public reverse-proxy URL).
    public let baseURL: URL

    public init(baseURL: URL) {
        self.baseURL = baseURL
    }

    private var apiBase: String {
        var s = baseURL.absoluteString
        while s.hasSuffix("/") { s.removeLast() }
        return s + "/api/v1"
    }

    /// Compose a full URL. `path` begins with `/` and already contains any encoded
    /// segments; `query` values are percent-encoded here.
    public func url(_ path: String, query: [(name: String, value: String)] = []) -> URL? {
        var s = apiBase + path
        if !query.isEmpty {
            let pairs = query.map { "\($0.name)=\($0.value.uriComponentEncoded)" }
            s += "?" + pairs.joined(separator: "&")
        }
        return URL(string: s)
    }

    /// The WebSocket URL for `/ws`, derived from the base origin (http→ws, https→wss).
    public var webSocketURL: URL? {
        var s = baseURL.absoluteString
        while s.hasSuffix("/") { s.removeLast() }
        if s.hasPrefix("https://") {
            s = "wss://" + s.dropFirst("https://".count)
        } else if s.hasPrefix("http://") {
            s = "ws://" + s.dropFirst("http://".count)
        }
        return URL(string: s + "/ws")
    }
}

public extension String {
    /// Percent-encode as a URI component (encodes `/`, space, etc.), matching JavaScript's
    /// `encodeURIComponent`: everything escaped except `A–Z a–z 0–9 - _ . ! ~ * ' ( )`.
    var uriComponentEncoded: String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-_.!~*'()")
        return addingPercentEncoding(withAllowedCharacters: allowed) ?? self
    }
}
