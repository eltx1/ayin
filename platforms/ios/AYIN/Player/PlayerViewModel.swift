import AVFoundation
import Combine
import Foundation

@MainActor
final class PlayerViewModel: ObservableObject {
    @Published private(set) var player: AVPlayer?
    @Published private(set) var playback: NativePlayback?
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?

    let destination: PlayerDestination
    private let service: PlaybackService
    private var shouldResumeAfterInterruption = false

    init(destination: PlayerDestination, service: PlaybackService = PlaybackService()) {
        self.destination = destination
        self.service = service
    }

    func load() async {
        guard player == nil, !isLoading else { return }
        isLoading = true
        defer { isLoading = false }

        do {
            let playback = try await service.load(destination)
            try configureAudioSession()
            let player = AVPlayer(url: playback.sourceURL)
            player.automaticallyWaitsToMinimizeStalling = true
            player.allowsExternalPlayback = true
            self.playback = playback
            self.player = player
            player.play()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func handleAudioInterruption(_ notification: Notification) {
        guard
            let info = notification.userInfo,
            let rawType = info[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: rawType)
        else { return }

        switch type {
        case .began:
            shouldResumeAfterInterruption = player?.timeControlStatus == .playing
            player?.pause()
        case .ended:
            let rawOptions = info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            let options = AVAudioSession.InterruptionOptions(rawValue: rawOptions)
            if shouldResumeAfterInterruption && options.contains(.shouldResume) {
                player?.play()
            }
            shouldResumeAfterInterruption = false
        @unknown default:
            break
        }
    }

    func stop() {
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        player = nil
        playback = nil
        shouldResumeAfterInterruption = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func configureAudioSession() throws {
        let audio = AVAudioSession.sharedInstance()
        try audio.setCategory(.playback, mode: .moviePlayback, options: [.allowAirPlay])
        try audio.setActive(true)
    }
}
