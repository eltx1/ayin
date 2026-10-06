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
        return [session.identity?.account.id ?? "guest", session.identity?.profile.id ?? "", session.token ?? ""].joined(separator: ":")
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
        .overlay(alignment: .bottom) {
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
        .task(id: sessionIdentity) {
            guard !session.isRestoring else {
                await model.stop(saveProgress: false)
                return
            }
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
