import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var session: SessionController
    @EnvironmentObject private var router: AppRouter
    @StateObject private var model = HomeViewModel()
    @State private var showingLogin = false

    var body: some View {
        NavigationStack {
            homeContent
                .navigationTitle("AYIN")
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) { webSearchButton }
                    ToolbarItem(placement: .topBarTrailing) { accountMenu }
                }
                .sheet(isPresented: $showingLogin) {
                    LoginView()
                        .environmentObject(session)
                }
                .task(id: sessionTaskIdentity) {
                    guard !session.isRestoring else {
                        model.prepareForSession(scope: "restoring")
                        return
                    }
                    await loadForCurrentSession()
                }
        }
    }

    @ViewBuilder
    private var homeContent: some View {
        if session.isRestoring {
            ProgressView("Restoring session…")
        } else {
            switch model.contentState(for: sessionTaskIdentity) {
            case .loading:
                ProgressView("Loading AYIN…")
            case let .unavailable(error):
                unavailableContent(error)
            case .empty:
                emptyContent
            case .content:
                discoveryContent
            }
        }
    }

    private func unavailableContent(_ error: String) -> some View {
        VStack(spacing: 16) {
            ContentUnavailableView(
                "AYIN is unavailable",
                systemImage: "wifi.exclamationmark",
                description: Text(error)
            )
            retryButton
        }
    }

    private var emptyContent: some View {
        VStack(spacing: 16) {
            ContentUnavailableView(
                "No content to show yet",
                systemImage: "rectangle.stack",
                description: Text("Try loading Home again or browse AYIN on the web.")
            )
            retryButton
            webBrowseButton
            webSessionNotice
        }
    }

    private var discoveryContent: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 28) {
                ForEach(model.rows) { row in
                    if !row.items.isEmpty { discoveryRow(row) }
                }
            }
            .padding(.vertical)
        }
        .refreshable { await loadForCurrentSession() }
    }

    private var webSearchButton: some View {
        Button {
            openWebDiscovery(.search)
        } label: {
            Label(
                NativeStrings.discoverySearchTitle(isKids: isKidsProfile),
                systemImage: isKidsProfile ? "sparkles.tv" : "magnifyingglass"
            )
        }
        .disabled(!canOpenWebDiscovery)
        .accessibilityHint("Opens in Safari. Web sign-in is separate from this app.")
    }

    @ViewBuilder
    private var accountMenu: some View {
        if session.isAuthenticated, let identity = session.identity {
            Menu {
                Button("Sign out", role: .destructive) {
                    Task {
                        model.prepareForSession(scope: "guest")
                        await session.logout()
                    }
                }
            } label: {
                Label(identity.account.displayName, systemImage: "person.crop.circle")
                    .labelStyle(.iconOnly)
            }
            .accessibilityLabel(identity.account.displayName)
        } else if session.isRestoring {
            ProgressView()
                .accessibilityLabel("Restoring session")
        } else {
            Menu {
                Button("Sign in") { showingLogin = true }
                if session.restoreErrorMessage != nil, session.token != nil {
                    Button("Retry saved session") {
                        Task { await session.retryRestore() }
                    }
                }
            } label: {
                Text("Sign in")
            }
        }
    }

    private var sessionTaskIdentity: String {
        if session.isRestoring { return "restoring" }
        guard let identity = session.identity else { return "guest" }
        return "\(identity.account.id):\(identity.profile.id):\(identity.profile.isKids)"
    }

    private var isKidsProfile: Bool { session.identity?.profile.isKids == true }

    private var canOpenWebDiscovery: Bool {
        !session.isRestoring && session.restoreErrorMessage == nil
    }

    private func openWebDiscovery(_ destination: DiscoveryWebDestination) {
        guard canOpenWebDiscovery else { return }
        router.openDiscovery(destination, isKids: isKidsProfile)
    }

    private var retryButton: some View {
        Button("Try again") {
            Task { await loadForCurrentSession() }
        }
        .buttonStyle(.borderedProminent)
    }

    private var webBrowseButton: some View {
        Button(NativeStrings.discoveryBrowseTitle(isKids: isKidsProfile)) {
            openWebDiscovery(.home)
        }
        .disabled(!canOpenWebDiscovery)
    }

    private var webSessionNotice: some View {
        Text(NativeStrings.webSessionNotice(canOpen: canOpenWebDiscovery))
            .font(.caption)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .padding(.horizontal)
    }

    private func loadForCurrentSession() async {
        model.prepareForSession(scope: sessionTaskIdentity)
        let token = session.isAuthenticated ? session.token : nil
        let result = await model.load(token: token)
        if result == .authenticationRejected {
            session.invalidateLocalSession()
            model.prepareForSession(scope: "guest")
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
                                DiscoveryArtwork(artworkObjectKey: item.artworkObjectKey, type: item.type)

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

            if row.hasMore {
                VStack(spacing: 8) {
                    webBrowseButton
                        .accessibilityLabel(NativeStrings.browseMoreAccessibilityLabel(rowTitle: row.title))
                        .accessibilityHint(NativeStrings.discoveryBrowseHint(isKids: isKidsProfile))
                    webSessionNotice
                }
                .frame(maxWidth: .infinity)
            }
        }
    }
}
