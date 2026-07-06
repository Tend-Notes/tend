// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Heuristics the embedded Authelia login flow uses to decide when authentication *may*
/// have completed. The definitive confirmation is a successful `/whoami`; these just tell
/// the coordinator when it's worth checking, so the WKWebView isn't polled needlessly.
public enum LoginDetector {
    /// Common Authelia session cookie names (deployments may rename; treated as hints).
    public static let knownSessionCookieNames = ["authelia_session", "authelia_session_1"]

    /// Whether a navigation has returned to the Tend origin (same host as the server),
    /// i.e. the proxy let the request through rather than redirecting to the auth portal.
    public static func isBackAtServer(navigatedURL: URL, serverURL: URL) -> Bool {
        guard let a = navigatedURL.host?.lowercased(), let b = serverURL.host?.lowercased() else {
            return false
        }
        return a == b
    }

    /// Whether the cookies for the server URL include a plausible session cookie — either a
    /// known Authelia name, or (fallback) any non-empty cookie scoped to the host.
    public static func hasSessionCookie(_ cookies: [HTTPCookie], serverURL: URL) -> Bool {
        let scoped = CookieJar.cookies(for: serverURL, from: cookies)
        if scoped.contains(where: { knownSessionCookieNames.contains($0.name) && !$0.value.isEmpty }) {
            return true
        }
        return scoped.contains { !$0.value.isEmpty }
    }

    /// Combined signal: back at the server origin *and* a session cookie is present. When
    /// true, the coordinator should confirm with `/whoami`.
    public static func looksAuthenticated(navigatedURL: URL, serverURL: URL, cookies: [HTTPCookie]) -> Bool {
        isBackAtServer(navigatedURL: navigatedURL, serverURL: serverURL)
            && hasSessionCookie(cookies, serverURL: serverURL)
    }
}
