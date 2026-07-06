// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation
import Observation
import TendModel
import TendAPI
import TendStore
import TendStoreGRDB
import TendAuth
#if canImport(WebKit)
import WebKit
#endif

/// Composition root and top-level app state. Wires the TendKit modules together:
/// a configured ``ServerProfile`` → cookie-authenticated ``TendAPIClient`` → encrypted
/// GRDB ``PageStore`` → ``SyncEngine``, with credentials in the Keychain.
///
/// The authenticated identity is derived from the live session: after the embedded Authelia
/// login captures cookies, `/whoami` confirms and yields the username.
@Observable
@MainActor
final class AppEnvironment {
    enum Status: Equatable {
        case bootstrapping
        case needsServer
        case needsLogin(ServerProfile)
        case authenticated(ServerProfile, username: String)
    }

    private(set) var status: Status = .bootstrapping

    // Collaborators (built as configuration becomes available).
    private let credentials: CredentialStore
    private let cookieStorage: HTTPCookieStorage
    private var api: TendAPIClient?
    private var store: (any PageStore)?
    private(set) var syncEngine: SyncEngine?

    private let profileDefaultsKey = "tend.currentProfile"

    init(credentials: CredentialStore? = nil, cookieStorage: HTTPCookieStorage = .shared) {
        self.cookieStorage = cookieStorage
        #if canImport(Security)
        self.credentials = credentials ?? KeychainCredentialStore()
        #else
        self.credentials = credentials ?? InMemoryCredentialStore()
        #endif
    }

    /// The current server's API client, when configured. Exposed for feature views.
    var client: TendAPIClient? { api }
    var currentProfile: ServerProfile? {
        switch status {
        case .needsLogin(let p): return p
        case .authenticated(let p, _): return p
        default: return nil
        }
    }

    /// Restore a saved server + session on launch and verify it, else route to setup/login.
    func bootstrap() async {
        guard let profile = loadSavedProfile() else {
            status = .needsServer
            return
        }
        configure(for: profile)
        await verify(profile)
    }

    /// Configure the API client (and store/engine) for a profile, injecting any stored
    /// cookies so requests are authenticated.
    private func configure(for profile: ServerProfile) {
        let stored = (try? credentials.loadCookies(serverId: profile.id)) ?? []
        CookieJar.inject(stored, into: cookieStorage)
        let session = URLSessionTransport.makeSession(cookieStorage: cookieStorage)
        let client = LiveTendAPIClient(baseURL: profile.baseURL, transport: URLSessionTransport(session: session))
        self.api = client

        if store == nil {
            store = try? GRDBPageStore(path: Self.databaseURL())
        }
        if let store {
            syncEngine = SyncEngine(store: store, api: client, serverId: profile.id)
        }
    }

    /// Confirm the session with `/whoami`; on 401 route to the embedded login.
    private func verify(_ profile: ServerProfile) async {
        guard let api else { status = .needsLogin(profile); return }
        do {
            let who = try await api.whoami()
            try? credentials.saveUsername(who.username, serverId: profile.id)
            status = .authenticated(profile, username: who.username)
        } catch TendAPIError.unauthorized {
            status = .needsLogin(profile)
        } catch {
            // Network/other error: fall back to login rather than block the app.
            status = .needsLogin(profile)
        }
    }

    // MARK: - Intents

    /// Set (or change) the server the app talks to.
    func setServer(url: URL, name: String? = nil) {
        let profile = ServerProfile(
            id: UUID().uuidString,
            name: name ?? (url.host ?? url.absoluteString),
            baseURL: url
        )
        saveProfile(profile)
        configure(for: profile)
        status = .needsLogin(profile)
    }

    #if canImport(WebKit)
    /// Called by the login view once Authelia's page has set the session cookie: persist the
    /// captured cookies and re-verify.
    func completeLogin(cookies: [HTTPCookie], for profile: ServerProfile) async {
        let scoped = CookieJar.cookies(for: profile.baseURL, from: cookies)
        let stored = scoped.map(StoredCookie.init)
        try? credentials.saveCookies(stored, serverId: profile.id)
        CookieJar.inject(stored, into: cookieStorage)
        await verify(profile)
    }
    #endif

    /// Route back to server entry (e.g. from the login screen's "Change Server").
    func chooseDifferentServer() {
        UserDefaults.standard.removeObject(forKey: profileDefaultsKey)
        status = .needsServer
    }

    func signOut() {
        guard let profile = currentProfile else { return }
        try? credentials.deleteCookies(serverId: profile.id)
        // Also clear the live cookie storage for this host.
        for cookie in cookieStorage.cookies(for: profile.baseURL) ?? [] {
            cookieStorage.deleteCookie(cookie)
        }
        status = .needsLogin(profile)
    }

    // MARK: - Persistence

    private func saveProfile(_ profile: ServerProfile) {
        if let data = try? JSONEncoder().encode(profile) {
            UserDefaults.standard.set(data, forKey: profileDefaultsKey)
        }
    }
    private func loadSavedProfile() -> ServerProfile? {
        guard let data = UserDefaults.standard.data(forKey: profileDefaultsKey) else { return nil }
        return try? JSONDecoder().decode(ServerProfile.self, from: data)
    }

    private static func databaseURL() throws -> URL {
        let dir = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        )
        return dir.appendingPathComponent("tend.sqlite")
    }
}
