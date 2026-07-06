// SPDX-License-Identifier: MIT WITH Commons-Clause
import XCTest
@testable import TendAuth
import TendModel
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

private let server = URL(string: "https://notes.example.com")!

private func cookie(_ name: String, _ value: String, domain: String = "notes.example.com", secure: Bool = true, expires: Date? = nil) -> HTTPCookie {
    var props: [HTTPCookiePropertyKey: Any] = [
        .name: name, .value: value, .domain: domain, .path: "/",
    ]
    if secure { props[.secure] = "TRUE" }
    if let expires { props[.expires] = expires }
    return HTTPCookie(properties: props)!
}

final class StoredCookieTests: XCTestCase {
    func testRoundTripThroughHTTPCookie() throws {
        let original = cookie("authelia_session", "abc123")
        let stored = StoredCookie(original)
        XCTAssertEqual(stored.name, "authelia_session")
        XCTAssertEqual(stored.value, "abc123")
        let rebuilt = try XCTUnwrap(stored.httpCookie)
        XCTAssertEqual(rebuilt.name, "authelia_session")
        XCTAssertEqual(rebuilt.value, "abc123")
        XCTAssertEqual(rebuilt.domain.hasSuffix("notes.example.com"), true)
    }

    func testExpiryDetection() {
        let past = Date(timeIntervalSince1970: 1_000)
        let stored = StoredCookie(name: "x", value: "y", domain: "notes.example.com", path: "/", isSecure: true, expiresDate: past)
        XCTAssertTrue(stored.isExpired(now: Date(timeIntervalSince1970: 2_000)))
        // Session cookie (no expiry) is never expired.
        let session = StoredCookie(name: "s", value: "v", domain: "notes.example.com", path: "/", isSecure: true, expiresDate: nil)
        XCTAssertFalse(session.isExpired(now: Date()))
    }
}

final class CookieJarTests: XCTestCase {
    func testFiltersByHostAndExpiry() {
        let now = Date(timeIntervalSince1970: 10_000)
        let cookies = [
            cookie("authelia_session", "a"),                         // host match
            cookie("other", "b", domain: "evil.example.org"),        // different host
            cookie("stale", "c", expires: Date(timeIntervalSince1970: 1)), // expired
        ]
        let matched = CookieJar.cookies(for: server, from: cookies, now: now)
        XCTAssertEqual(matched.map(\.name), ["authelia_session"])
    }

    func testDotDomainMatchesHost() {
        let c = cookie("s", "v", domain: ".example.com")
        let matched = CookieJar.cookies(for: server, from: [c])
        XCTAssertEqual(matched.count, 1)
    }
}

final class LoginDetectorTests: XCTestCase {
    func testBackAtServerByHost() {
        XCTAssertTrue(LoginDetector.isBackAtServer(navigatedURL: URL(string: "https://notes.example.com/journals")!, serverURL: server))
        XCTAssertFalse(LoginDetector.isBackAtServer(navigatedURL: URL(string: "https://auth.example.com/")!, serverURL: server))
    }

    func testLooksAuthenticatedRequiresBothSignals() {
        let atAuthPortal = URL(string: "https://auth.example.com/")!
        let atServer = URL(string: "https://notes.example.com/")!
        let cookies = [cookie("authelia_session", "abc")]
        XCTAssertFalse(LoginDetector.looksAuthenticated(navigatedURL: atAuthPortal, serverURL: server, cookies: cookies))
        XCTAssertTrue(LoginDetector.looksAuthenticated(navigatedURL: atServer, serverURL: server, cookies: cookies))
        // Back at server but no cookie yet -> not authenticated.
        XCTAssertFalse(LoginDetector.looksAuthenticated(navigatedURL: atServer, serverURL: server, cookies: []))
    }
}

final class InMemoryCredentialStoreTests: XCTestCase {
    func testCookieAndUsernameRoundTrip() throws {
        let store = InMemoryCredentialStore()
        let cookies = [StoredCookie(cookie("authelia_session", "abc"))]
        try store.saveCookies(cookies, serverId: "s1")
        try store.saveUsername("alice", serverId: "s1")

        XCTAssertEqual(try store.loadCookies(serverId: "s1"), cookies)
        XCTAssertEqual(try store.loadUsername(serverId: "s1"), "alice")

        // Scoping: another server is independent.
        XCTAssertEqual(try store.loadCookies(serverId: "s2"), [])

        try store.deleteCookies(serverId: "s1")
        XCTAssertEqual(try store.loadCookies(serverId: "s1"), [])
    }
}
