import AVFoundation
import SwiftUI

struct PlayerScreen: View {
    @EnvironmentObject private var router: AppRouter
    @EnvironmentObject private var session: SessionController
    @StateObject private var model: PlayerViewModel
    @State private var isLeavingPlayer = false
    @State private var webStopStarted = false
    @State private var webContinuationTask: Task<Void, Never>?

    init(destination: PlayerDestination) {
        _model = StateObject(wrappedValue: PlayerViewModel(destination: destination))
    }

    private var playerSessionIdentity: String {
        if session.isRestoring { return "restoring" }
        return [session.identity?.account.id ?? "guest", session.identity?.profile.id ?? "",
                session.identity?.profile.isKids == true ? "kids" : "general", session.token ?? ""].joined(separator: ":")
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if isLeavingPlayer {
                ProgressView("Opening…")
                    .tint(.white)
                    .foregroundStyle(.white)
            } else if let player = model.player {
                NativePlayerController(player: player)
                    .ignoresSafeArea()
            } else if model.isLoading {
                ProgressView()
                    .tint(.white)
                    .accessibilityLabel("Loading video…")
            } else {
                VStack(spacing: 16) {
                    ContentUnavailableView(
                        "Playback unavailable",
                        systemImage: "play.slash",
                        description: Text(NativeStrings.playbackFailureMessage(model.errorMessage))
                    )
                    Button("Try again") {
                        Task {
                            guard !isLeavingPlayer, router.player == model.destination, !session.isRestoring,
                                  session.token == nil || session.isAuthenticated else { return }
                            await model.retry(
                                token: session.isAuthenticated ? session.token : nil,
                                profileId: session.identity?.profile.id,
                                accountId: session.identity?.account.id,
                                isKids: session.identity?.profile.isKids == true
                            )
                        }
                    }
                    .disabled(isLeavingPlayer)
                    .buttonStyle(.borderedProminent)
                }
                .foregroundStyle(.white)
            }
        }
        .overlay(alignment: .top) {
            HStack(spacing: 12) {
                Button {
                    webContinuationTask?.cancel()
                    router.closePlayer()
                } label: {
                    Image(systemName: "xmark")
                        .font(.headline)
                        .padding(12)
                        .background(.ultraThinMaterial, in: Circle())
                }
                .accessibilityLabel("Close player")

                Spacer()

                if model.playback?.isLive == false || isLeavingPlayer {
                    Button(action: openOnWeb) {
                        Label(NativeStrings.openOnWebTitle(isOpening: isLeavingPlayer), systemImage: "safari")
                            .font(.subheadline.weight(.semibold))
                            .padding(12)
                            .background(.ultraThinMaterial, in: Capsule())
                    }
                    .disabled(isLeavingPlayer)
                    .accessibilityHint("Continue with available captions, chapters and next episodes.")
                }

                if let shareURL = model.playback?.shareURL {
                    ShareLink(item: shareURL) {
                        Image(systemName: "square.and.arrow.up")
                            .font(.headline)
                            .padding(12)
                            .background(.ultraThinMaterial, in: Circle())
                    }
                    .disabled(isLeavingPlayer)
                    .accessibilityLabel("Share")
                }
            }
            .padding()
        }
        .overlay(alignment: .bottom) {
            if model.progressNeedsReview && !isLeavingPlayer {
                VStack(spacing: 8) {
                    Text("Playback continues. Review saved progress before saving more.")
                        .font(.callout)
                    Button(NativeStrings.progressReviewTitle(isReviewing: model.isReviewingProgress)) {
                        model.reviewProgress()
                    }
                    .disabled(model.isReviewingProgress)
                    .buttonStyle(.borderedProminent)
                }
                .padding()
                .background(.ultraThinMaterial)
                .padding()
            }
        }
        .task(id: playerSessionIdentity + (isLeavingPlayer ? ":leaving" : "")) {
            guard !isLeavingPlayer, router.player == model.destination else { return }
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
        .onReceive(session.$identity) { identity in
            model.viewerDidChange(token: identity == nil ? nil : session.token,
                                  accountId: identity?.account.id, profileId: identity?.profile.id,
                                  isKids: identity?.profile.isKids == true)
        }
        .onChange(of: playerSessionIdentity) { _, _ in
            cancelWebContinuationForViewerChange()
        }
        .onReceive(session.$isRestoring) { restoring in
            if restoring {
                model.invalidateViewer()
                cancelWebContinuationForViewerChange()
            }
        }
        .onDisappear {
            webContinuationTask?.cancel()
            // The Web transition already owns the final checkpoint and media release.
            if !webStopStarted { Task { await model.stop() } }
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) {
            model.handleAudioInterruption($0)
        }
        .preferredColorScheme(.dark)
    }

    private func openOnWeb() {
        guard !isLeavingPlayer, let playback = model.playback, !playback.isLive else { return }
        let viewerIdentity = playerSessionIdentity
        isLeavingPlayer = true
        webStopStarted = false
        webContinuationTask = Task { @MainActor in
            let dismissed = await router.openPlaybackOnWeb(
                from: model.destination,
                shareURL: playback.shareURL,
                isCurrentViewer: { !session.isRestoring && playerSessionIdentity == viewerIdentity },
                stopPlayback: {
                    webStopStarted = true
                    return await model.stop()
                }
            )
            guard !Task.isCancelled, !dismissed, router.player == model.destination else { return }
            // A changed viewer or newer navigation cancels the transition. A new
            // native load must revalidate playback instead of reviving the old item.
            webStopStarted = false
            isLeavingPlayer = false
        }
    }

    private func cancelWebContinuationForViewerChange() {
        guard isLeavingPlayer else { return }
        webContinuationTask?.cancel()
        router.cancelPlaybackWebContinuation()
        webStopStarted = false
        isLeavingPlayer = false
    }
}
