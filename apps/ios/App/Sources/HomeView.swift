// SPDX-License-Identifier: MIT WITH Commons-Clause
import SwiftUI
import TendModel

/// Authenticated home: the list of journals (most recent first). A minimal surface that
/// exercises the full authenticated stack; the sidebar/todos/tags/command-palette and the
/// editable outline land in later phases.
struct HomeView: View {
    @Environment(AppEnvironment.self) private var env
    let profile: ServerProfile
    let username: String

    @State private var journals: [PageMeta] = []
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                if let error {
                    Text(error).foregroundStyle(.red).font(.footnote)
                }
                ForEach(journals) { meta in
                    NavigationLink(value: meta) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(meta.title).font(.body)
                            Text("\(meta.blockCount) block\(meta.blockCount == 1 ? "" : "s")")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .navigationTitle("Journals")
            .navigationDestination(for: PageMeta.self) { PageReaderView(meta: $0) }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Text(username).font(.subheadline).foregroundStyle(.secondary)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Sign Out", role: .destructive) { env.signOut() }
                        Button("Change Server") { env.chooseDifferentServer() }
                    } label: {
                        Image(systemName: "person.circle")
                    }
                }
            }
            .task { await load() }
            .refreshable { await load() }
        }
    }

    private func load() async {
        guard let api = env.client else { return }
        do {
            journals = try await api.listJournals().sorted { $0.name > $1.name }
            error = nil
        } catch {
            self.error = String(describing: error)
        }
    }
}

/// Read-only outline view of a page/journal. The editable native outliner replaces this in
/// the editor phase; this proves the read path (fetch + tokenized render + tree indent).
struct PageReaderView: View {
    @Environment(AppEnvironment.self) private var env
    let meta: PageMeta

    @State private var page: Page?
    @State private var error: String?

    var body: some View {
        Group {
            if let page {
                ScrollView {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(page.blocksInOrder) { block in
                            HStack(alignment: .top, spacing: 8) {
                                Circle()
                                    .frame(width: 5, height: 5)
                                    .foregroundStyle(.secondary)
                                    .padding(.top, 7)
                                Text(renderInline(block.content))
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .padding(.leading, CGFloat(block.depth) * 16)
                        }
                    }
                    .padding()
                }
            } else if let error {
                ContentUnavailableView("Couldn't load", systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
                ProgressView()
            }
        }
        .navigationTitle(meta.title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        guard let api = env.client else { return }
        do {
            page = meta.isJournal
                ? try await api.getJournal(date: meta.name)
                : try await api.getPage(name: meta.name)
            error = nil
        } catch {
            self.error = String(describing: error)
        }
    }
}
