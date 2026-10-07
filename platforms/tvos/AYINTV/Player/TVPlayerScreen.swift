import SwiftUI

struct TVPlayerScreen: View {
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var session: SessionController
    @StateObject private var model: TVPlayerViewModel

    init(destination: TVPlaybackDestination) {
        _model = StateObject(wrappedValue: TVPlayerViewModel(destination: destination))
    }

    private var sessionIdentity: String {
        if session.isRestoring { return "restoring" }
        return [session.identity?.account.id ?? "guest", session.identity?.profile.id ?? "",
                session.identity?.profile.isKids == true ? "kids" : "general", session.token ?? ""].joined(separator: ":")
    }

    var body: some View {
        sessionPlayback
            .onChange(of: scenePhase) { _, phase in
                model.handleScene(active: phase == .active)
            }
            .onDisappear {
                Task<Void, Never> { _ = await model.stop() }
            }
    }

    private var sessionPlayback: some View {
        playbackWithProgress
            .task(id: sessionIdentity) {
                await loadCurrentViewer()
            }
            .onReceive(session.$identity, perform: viewerIdentityDidChange)
            .onReceive(session.$isRestoring, perform: restorationDidChange)
    }

    private var playbackWithProgress: some View {
        playbackContent
            .overlay(alignment: .bottom) {
                progressReviewOverlay
            }
    }

    private func loadCurrentViewer() async {
        guard !session.isRestoring, session.token == nil || session.isAuthenticated else {
            model.invalidateViewer()
            return
        }
        await model.load(
            token: session.isAuthenticated ? session.token : nil,
            profileId: session.identity?.profile.id,
            accountId: session.identity?.account.id,
            isKids: session.identity?.profile.isKids == true
        )
    }

    private func viewerIdentityDidChange(_ identity: AYINIdentity?) {
        model.viewerDidChange(token: identity == nil ? nil : session.token,
                              accountId: identity?.account.id, profileId: identity?.profile.id,
                              isKids: identity?.profile.isKids == true)
    }

    private func restorationDidChange(_ restoring: Bool) {
        if restoring { model.invalidateViewer() }
    }

    private var playbackContent: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if model.player != nil {
                TVPlayerController(model: model)
                    .ignoresSafeArea()
            } else if model.isLoading {
                ProgressView("Loading…")
            } else {
                unavailableContent
            }
        }
    }

    private var unavailableContent: some View {
        VStack(spacing: 30) {
            ContentUnavailableView(
                "Playback unavailable",
                systemImage: "play.slash",
                description: Text(model.errorMessage ?? "AYIN could not start this title.")
            )
            Button("Try Again") {
                Task {
                    guard !session.isRestoring, session.token == nil || session.isAuthenticated else { return }
                    await model.retry(token: session.token, profileId: session.identity?.profile.id,
                                      accountId: session.identity?.account.id,
                                      isKids: session.identity?.profile.isKids == true)
                }
            }
        }
    }

    @ViewBuilder
    private var progressReviewOverlay: some View {
        if model.progressNeedsReview {
            VStack(spacing: 16) {
                Text("Playback continues. Review saved progress before saving more.")
                Button(model.isReviewingProgress ? "Reviewing…" : "Review saved progress") {
                    model.reviewProgress()
                }
                .disabled(model.isReviewingProgress)
            }
            .padding(30)
            .background(.ultraThinMaterial)
            .padding(40)
        }
    }
}
