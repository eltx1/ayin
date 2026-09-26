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
        return session.identity?.account.id ?? "guest"
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if model.player != nil {
                TVPlayerController(model: model)
                    .ignoresSafeArea()
            } else if model.isLoading {
                ProgressView("Loading…")
            } else {
                VStack(spacing: 30) {
                    ContentUnavailableView(
                        "Playback unavailable",
                        systemImage: "play.slash",
                        description: Text(model.errorMessage ?? "AYIN could not start this title.")
                    )
                    Button("Try Again") {
                        Task { await model.retry() }
                    }
                }
            }
        }
        .task(id: sessionIdentity) {
            guard !session.isRestoring else { return }
            await model.load(
                token: session.isAuthenticated ? session.token : nil,
                profileId: session.isAuthenticated ? session.identity?.profile.id : nil
            )
        }
        .onChange(of: scenePhase) { _, phase in
            model.handleScene(active: phase == .active)
        }
        .onDisappear {
            Task { await model.stop() }
        }
    }
}
