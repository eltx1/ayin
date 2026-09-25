import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var session: SessionController
    @EnvironmentObject private var router: AppRouter
    @StateObject private var model = HomeViewModel()
    @State private var showingLogin = false

    var body: some View {
        NavigationStack {
            Group {
                if model.isLoading && model.rows.isEmpty {
                    ProgressView("Loading AYIN…")
                } else if let error = model.errorMessage, model.rows.isEmpty {
                    ContentUnavailableView(
                        "AYIN is unavailable",
                        systemImage: "wifi.exclamationmark",
                        description: Text(error)
                    )
                } else {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 28) {
                            ForEach(model.rows) { row in
                                if !row.items.isEmpty {
                                    discoveryRow(row)
                                }
                            }
                        }
                        .padding(.vertical)
                    }
                    .refreshable {
                        await model.load(token: session.token)
                    }
                }
            }
            .navigationTitle("AYIN")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if session.isAuthenticated, let identity = session.identity {
                        Menu {
                            Button("Sign out", role: .destructive) {
                                Task {
                                    await session.logout()
                                    await model.load(token: nil)
                                }
                            }
                        } label: {
                            Label(identity.account.displayName, systemImage: "person.crop.circle")
                                .labelStyle(.iconOnly)
                        }
                        .accessibilityLabel(identity.account.displayName)
                    } else {
                        Button("Sign in") { showingLogin = true }
                    }
                }
            }
            .sheet(isPresented: $showingLogin) {
                LoginView()
                    .environmentObject(session)
            }
            .task(id: session.identity?.account.id ?? "guest") {
                await model.load(token: session.token)
            }
        }
    }

    @ViewBuilder
    private func discoveryRow(_ row: DiscoveryRow) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(row.title)
                .font(.title2.bold())
                .padding(.horizontal)

            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 14) {
                    ForEach(row.items) { item in
                        Button {
                            router.openHref(item.href)
                        } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                RoundedRectangle(cornerRadius: 14)
                                    .fill(.quaternary)
                                    .frame(width: 210, height: 118)
                                    .overlay {
                                        Image(systemName: item.type == "VIDEO" ? "play.fill" : "sparkles.tv")
                                            .font(.largeTitle)
                                            .foregroundStyle(.secondary)
                                    }

                                Text(item.title)
                                    .font(.headline)
                                    .foregroundStyle(.primary)
                                    .lineLimit(2)

                                Text(item.meta ?? item.kicker)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            .frame(width: 210, alignment: .leading)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal)
            }
        }
    }
}
