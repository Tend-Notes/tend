// SPDX-License-Identifier: MIT WITH Commons-Clause
import SwiftUI
import WebKit
import TendModel
import TendAuth

/// The single web surface in the app: Authelia's own login page, shown to capture the
/// session cookie. After each navigation we check whether we've landed back on the Tend
/// origin with a session cookie; if so we hand the cookies to ``AppEnvironment`` which
/// confirms via `/whoami`. Everything else in the app is native.
struct AutheliaLoginView: View {
    @Environment(AppEnvironment.self) private var env
    let profile: ServerProfile

    var body: some View {
        NavigationStack {
            AutheliaWebView(url: profile.baseURL) { navigatedURL, cookies in
                guard LoginDetector.looksAuthenticated(
                    navigatedURL: navigatedURL, serverURL: profile.baseURL, cookies: cookies
                ) else { return }
                Task { await env.completeLogin(cookies: cookies, for: profile) }
            }
            .ignoresSafeArea(edges: .bottom)
            .navigationTitle("Sign In")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Change Server") { env.chooseDifferentServer() }
                }
            }
        }
    }
}

/// A `WKWebView` that reports each finished navigation's URL and cookies. Uses the default
/// persistent data store so the Authelia session cookie survives the redirect dance.
private struct AutheliaWebView: UIViewRepresentable {
    let url: URL
    let onNavigated: (URL, [HTTPCookie]) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onNavigated: onNavigated) }

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        webView.navigationDelegate = context.coordinator
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        private let onNavigated: (URL, [HTTPCookie]) -> Void
        init(onNavigated: @escaping (URL, [HTTPCookie]) -> Void) { self.onNavigated = onNavigated }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            let current = webView.url ?? URL(string: "about:blank")!
            webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { [onNavigated] cookies in
                onNavigated(current, cookies)
            }
        }
    }
}
