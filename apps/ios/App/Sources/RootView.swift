// SPDX-License-Identifier: MIT WITH Commons-Clause
import SwiftUI

/// Routes the app by authentication state: server entry → embedded Authelia login →
/// authenticated home.
struct RootView: View {
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        switch env.status {
        case .bootstrapping:
            ProgressView("Loading…")
        case .needsServer:
            ServerSetupView()
        case .needsLogin(let profile):
            AutheliaLoginView(profile: profile)
        case .authenticated(let profile, let username):
            HomeView(profile: profile, username: username)
        }
    }
}
