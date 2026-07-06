// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Moves cookies between the WKWebView login capture, persistent storage (``StoredCookie``
/// in the Keychain), and the API client's `HTTPCookieStorage`. Pure and side-effect-scoped
/// so it can be unit-tested.
public enum CookieJar {
    /// Cookies relevant to a server host: those whose domain matches the host (exact or a
    /// dot-suffix), non-expired. Used to pick out the session cookie(s) after login.
    public static func cookies(for url: URL, from all: [HTTPCookie], now: Date = Date()) -> [HTTPCookie] {
        guard let host = url.host?.lowercased() else { return [] }
        return all.filter { cookie in
            if let expires = cookie.expiresDate, expires <= now { return false }
            let domain = cookie.domain.lowercased()
            let bare = domain.hasPrefix(".") ? String(domain.dropFirst()) : domain
            return host == bare || host.hasSuffix("." + bare)
        }
    }

    /// Install stored cookies into a cookie storage (e.g. the API session's storage), so
    /// subsequent requests carry them. Skips any that fail to reconstruct or have expired.
    public static func inject(_ stored: [StoredCookie], into storage: HTTPCookieStorage, now: Date = Date()) {
        for item in stored where !item.isExpired(now: now) {
            if let cookie = item.httpCookie {
                storage.setCookie(cookie)
            }
        }
    }

    /// Snapshot the cookies a storage holds for a given URL, as persistable values.
    public static func snapshot(for url: URL, from storage: HTTPCookieStorage) -> [StoredCookie] {
        (storage.cookies(for: url) ?? []).map(StoredCookie.init)
    }
}
