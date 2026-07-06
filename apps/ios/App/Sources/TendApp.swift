// SPDX-License-Identifier: MIT WITH Commons-Clause
import SwiftUI

@main
struct TendApp: App {
    @State private var env = AppEnvironment()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(env)
                .task { await env.bootstrap() }
        }
    }
}
