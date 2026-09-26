import SwiftUI

struct TVHomeView: View {
    @EnvironmentObject private var session: SessionController
    @EnvironmentObject private var router: TVRouter
    @StateObject private var model = TVHomeViewModel()

    private var sessionIdentity: String {
        if session.isRestoring { return "restoring" }
        return session.identity?.account.id ?? "guest"
    }

    var body: some View {
        Group {
            if model.isLoading && model.rows.isEmpty {
                ProgressView("Loading AYIN…")
            } else if let error = model.errorMessage, model.rows.isEmpty {
                VStack(spacing: 30) {
                    ContentUnavailableView(
                        "AYIN is unavailable",
                        systemImage: "wifi.exclamationmark",
                        description: Text(error)
                    )
                    Button("Try Again") {
                        Task { await load() }
                    }
                }
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 44) {
                        ForEach(model.rows) { row in
                            if !row.items.isEmpty {
                                VStack(alignment: .leading, spacing: 20) {
                                    Text(row.title)
                                        .font(.title2.bold())
                                        .padding(.horizontal, 70)

                                    ScrollView(.horizontal, showsIndicators: false) {
                                        LazyHStack(spacing: 28) {
                                            ForEach(row.items) { item in
                                                TVContentCard(
                                                    title: item.title,
                                                    subtitle: item.meta ?? item.kicker,
                                                    artworkObjectKey: item.artworkObjectKey,
                                                    progress: item.progress
                                                ) {
                                                    router.open(href: item.href)
                                                }
                                            }

                                            if row.nextCursor != nil {
                                                Button {
                                                    Task {
                                                        await model.loadMore(
                                                            rowKey: row.key,
                                                            token: session.isAuthenticated ? session.token : nil
                                                        )
                                                    }
                                                } label: {
                                                    VStack(spacing: 14) {
                                                        Image(systemName: "arrow.right.circle.fill")
                                                            .font(.system(size: 54))
                                                        Text(model.isLoadingMore(row.key) ? "Loading…" : "More")
                                                            .font(.headline)
                                                    }
                                                    .frame(width: 180, height: 202)
                                                }
                                                .buttonStyle(.card)
                                                .disabled(model.isLoadingMore(row.key))
                                            }
                                        }
                                        .padding(.horizontal, 70)
                                        .padding(.vertical, 8)
                                    }
                                    .focusSection()
                                }
                            }
                        }
                    }
                    .padding(.vertical, 36)
                }
            }
        }
        .navigationTitle("Home")
        .task(id: sessionIdentity) {
            guard !session.isRestoring else { return }
            await load()
        }
    }

    private func load() async {
        await model.load(token: session.isAuthenticated ? session.token : nil)
    }
}
