import SwiftUI

struct TVMyAyinView: View {
    @EnvironmentObject private var session: SessionController
    @EnvironmentObject private var router: TVRouter
    @StateObject private var model = TVMyAyinViewModel()

    var body: some View {
        Group {
            if session.isRestoring {
                ProgressView("Restoring your AYIN session…")
            } else if !session.isAuthenticated {
                ContentUnavailableView(
                    "Sign in to continue",
                    systemImage: "person.crop.circle",
                    description: Text("Continue Watching and your AYIN library are available after sign in.")
                )
            } else if model.isLoading && model.sections.isEmpty {
                ProgressView()
            } else if let error = model.errorMessage, model.sections.isEmpty {
                VStack(spacing: 30) {
                    ContentUnavailableView(
                        "Couldn’t load My AYIN",
                        systemImage: "exclamationmark.triangle",
                        description: Text(error)
                    )
                    Button("Try Again") { Task { await load() } }
                }
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 44) {
                        ForEach(model.sections) { section in
                            if !section.items.isEmpty {
                                VStack(alignment: .leading, spacing: 20) {
                                    Text(section.title)
                                        .font(.title2.bold())
                                        .padding(.horizontal, 70)
                                    ScrollView(.horizontal, showsIndicators: false) {
                                        LazyHStack(spacing: 28) {
                                            ForEach(section.items) { item in
                                                TVContentCard(
                                                    title: item.title,
                                                    subtitle: item.meta ?? item.kicker,
                                                    artworkObjectKey: item.artworkObjectKey,
                                                    progress: item.progress
                                                ) {
                                                    router.open(href: item.href)
                                                }
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
        .navigationTitle("My AYIN")
        .task(id: session.identity?.profile.id ?? "guest") {
            await load()
        }
    }

    private func load() async {
        guard
            session.isAuthenticated,
            let token = session.token,
            let profileId = session.identity?.profile.id
        else {
            model.errorMessage = nil
            return
        }
        await model.load(token: token, profileId: profileId)
    }
}
