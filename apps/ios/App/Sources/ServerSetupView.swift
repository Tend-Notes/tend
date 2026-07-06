// SPDX-License-Identifier: MIT WITH Commons-Clause
import SwiftUI

/// First-run screen to point the app at a Tend server (the public reverse-proxy origin).
struct ServerSetupView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var urlString = "https://"
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://notes.example.com", text: $urlString)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                        .textContentType(.URL)
                } header: {
                    Text("Tend server")
                } footer: {
                    Text("The address where your Tend instance is hosted. You'll sign in through your identity provider (Authelia) on the next screen.")
                }

                if let error {
                    Text(error).foregroundStyle(.red).font(.footnote)
                }

                Button("Continue") { submit() }
                    .disabled(normalizedURL(urlString) == nil)
            }
            .navigationTitle("Add Server")
        }
    }

    private func submit() {
        guard let url = normalizedURL(urlString) else {
            error = "Enter a valid URL."
            return
        }
        guard url.scheme == "https" else {
            error = "The server must use https."
            return
        }
        error = nil
        env.setServer(url: url)
    }

    /// Trim, default to https://, and require a host.
    private func normalizedURL(_ raw: String) -> URL? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text != "https://", text != "http://" else { return nil }
        if !text.contains("://") { text = "https://" + text }
        guard let url = URL(string: text), url.host?.isEmpty == false else { return nil }
        return url
    }
}
