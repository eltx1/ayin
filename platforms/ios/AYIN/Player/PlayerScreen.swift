import AVFoundation
import SwiftUI

struct PlayerScreen: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var session: SessionController
    @StateObject private var model: PlayerViewModel

    init(destination: PlayerDestination) {
        _model = StateObject(wrappedValue: PlayerViewModel(destination: destination))
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
                            await model.retry(
                                token: session.isAuthenticated ? session.token : nil,
                                profileId: session.isAuthenticated ? session.identity?.profile.id : nil
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
        .task {
            await model.load(
                token: session.isAuthenticated ? session.token : nil,
                profileId: session.isAuthenticated ? session.identity?.profile.id : nil
            )
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
