import AVFoundation
import SwiftUI

struct PlayerScreen: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var session: SessionController
    @StateObject private var model: PlayerViewModel

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

            if let player = model.player {
                NativePlayerController(player: player)
                    .ignoresSafeArea()
            } else if model.isLoading {
                ProgressView()
                    .tint(.white)
            } else {
                VStack(spacing: 16) {
                    ContentUnavailableView(
                        "Playback unavailable",
                        systemImage: "play.slash",
                        description: Text(model.errorMessage ?? "AYIN could not start this video.")
                    )
                    Button("Try again") {
                        Task {
                            guard !session.isRestoring, session.token == nil || session.isAuthenticated else { return }
                            await model.retry(
                                token: session.isAuthenticated ? session.token : nil,
                                profileId: session.identity?.profile.id,
                                accountId: session.identity?.account.id,
                                isKids: session.identity?.profile.isKids == true
                            )
                        }
                    }
                    .buttonStyle(.borderedProminent)
                }
                .foregroundStyle(.white)
            }
        }
        .overlay(alignment: .top) {
            HStack(spacing: 12) {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.headline)
                        .padding(12)
                        .background(.ultraThinMaterial, in: Circle())
                }
                .accessibilityLabel("Close player")

                Spacer()

                if let shareURL = model.playback?.shareURL {
                    ShareLink(item: shareURL) {
                        Image(systemName: "square.and.arrow.up")
                            .font(.headline)
                            .padding(12)
                            .background(.ultraThinMaterial, in: Circle())
                    }
                    .accessibilityLabel("Share")
                }
            }
            .padding()
        }
        .overlay(alignment: .bottom) {
            if model.progressNeedsReview {
                VStack(spacing: 8) {
                    Text("Playback continues. Review saved progress before saving more.")
                        .font(.callout)
                    Button(model.isReviewingProgress ? "Reviewing…" : "Review saved progress") {
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
        .task(id: playerSessionIdentity) {
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
        .onReceive(session.$isRestoring) { restoring in
            if restoring { model.invalidateViewer() }
        }
        .onDisappear {
            Task { await model.stop() }
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) {
            model.handleAudioInterruption($0)
        }
        .preferredColorScheme(.dark)
    }
}
