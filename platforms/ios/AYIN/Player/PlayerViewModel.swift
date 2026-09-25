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

    private let service: any PlaybackServicing
    private let progressService: any WatchProgressServicing
    private let analytics: any AnalyticsTracking

    private var sessionToken: String?
    private var profileId: String?
    private var shouldResumeAfterInterruption = false
    private var periodicObserver: Any?
    private var notificationObservers: [NSObjectProtocol] = []
    private var lastAnalyticsAt: Date?
    private var lastSavedPositionMs: Int?
    private var didComplete = false

    init(
        destination: PlayerDestination,
        service: any PlaybackServicing = PlaybackService(),
        progressService: any WatchProgressServicing = WatchProgressService(),
        analytics: any AnalyticsTracking = NativeAnalyticsClient()
    ) {
        self.destination = destination
        self.service = service
        self.progressService = progressService
        self.analytics = analytics
    }

    func load(token: String?, profileId: String?) async {
        guard player == nil, !isLoading else { return }
        isLoading = true
        errorMessage = nil
        sessionToken = token
        self.profileId = profileId
        let loadStartedAt = Date()
        defer { isLoading = false }

        do {
            let playback = try await service.load(destination)
            try configureAudioSession()

            let item = AVPlayerItem(url: playback.sourceURL)
            let player = AVPlayer(playerItem: item)
            player.automaticallyWaitsToMinimizeStalling = true
            player.allowsExternalPlayback = true

            self.playback = playback
            self.player = player

            if
                !playback.isLive,
                let token,
                let videoId = playback.videoId,
                let progress = try? await progressService.progress(
                    videoId: videoId,
                    profileId: profileId,
                    token: token
                ),
                progress.completedAt == nil,
                progress.positionMs > 0
            {
                await seek(player, toMilliseconds: progress.positionMs)
                lastSavedPositionMs = progress.positionMs
            }

            installPlaybackObservers(player: player, item: item)
            lastAnalyticsAt = Date()

            let startupMs = max(
                0,
                min(3_600_000, Int(Date().timeIntervalSince(loadStartedAt) * 1_000))
            )
            if playback.isLive {
                await emit("LIVE_PAGE_VIEW", playback: playback)
                await emit("LIVE_PLAY_START", playback: playback)
                await emit(
                    "LIVE_STARTUP",
                    playback: playback,
                    durationDeltaMs: startupMs
                )
            } else {
                await emit("VIDEO_START", playback: playback)
                await emit(
                    "VIDEO_STARTUP",
                    playback: playback,
                    durationDeltaMs: startupMs
                )
            }

            player.play()
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
            await analytics.emit(
                destination.kind == .live ? "LIVE_FATAL_ERROR" : "VIDEO_BUFFER",
                profileId: profileId,
                videoId: nil,
                channelId: nil,
                durationDeltaMs: nil,
                positionMs: nil,
                metadata: [
                    "stage": "load",
                    "slug": destination.slug,
                    "message": String(error.localizedDescription.prefix(200))
                ]
            )
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

    func stop() async {
        if let player {
            await checkpoint(player.currentTime(), forceProgressSave: true)
        }
        removePlaybackObservers()
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        player = nil
        playback = nil
        sessionToken = nil
        profileId = nil
        lastAnalyticsAt = nil
        lastSavedPositionMs = nil
        didComplete = false
        shouldResumeAfterInterruption = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func installPlaybackObservers(player: AVPlayer, item: AVPlayerItem) {
        removePlaybackObservers()

        periodicObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 15, preferredTimescale: 600),
            queue: .main
        ) { [weak self] time in
            Task { @MainActor [weak self] in
                await self?.checkpoint(time)
            }
        }

        let center = NotificationCenter.default
        notificationObservers.append(
            center.addObserver(
                forName: AVPlayerItem.playbackStalledNotification,
                object: item,
                queue: .main
            ) { [weak self] _ in
                Task { @MainActor [weak self] in
                    guard let self, let playback = self.playback else { return }
                    await self.emit(
                        playback.isLive ? "LIVE_REBUFFER" : "VIDEO_BUFFER",
                        playback: playback,
                        positionMs: self.currentPositionMs()
                    )
                }
            }
        )

        notificationObservers.append(
            center.addObserver(
                forName: AVPlayerItem.failedToPlayToEndTimeNotification,
                object: item,
                queue: .main
            ) { [weak self] notification in
                Task { @MainActor [weak self] in
                    guard let self, let playback = self.playback else { return }
                    let error = notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
                    await self.emit(
                        playback.isLive ? "LIVE_FATAL_ERROR" :
                            (playback.protocolName == "HLS" ? "VIDEO_HLS_FATAL" : "VIDEO_BUFFER"),
                        playback: playback,
                        positionMs: self.currentPositionMs(),
                        metadata: [
                            "protocol": playback.protocolName,
                            "message": String((error?.localizedDescription ?? "Playback failed").prefix(200))
                        ]
                    )
                }
            }
        )

        notificationObservers.append(
            center.addObserver(
                forName: AVPlayerItem.didPlayToEndTimeNotification,
                object: item,
                queue: .main
            ) { [weak self] _ in
                Task { @MainActor [weak self] in
                    guard let self, !self.didComplete, let playback = self.playback else { return }
                    self.didComplete = true
                    if let player = self.player {
                        await self.checkpoint(player.currentTime(), forceProgressSave: true)
                    }
                    await self.emit(
                        playback.isLive ? "LIVE_PLAY_COMPLETE" : "VIDEO_COMPLETE",
                        playback: playback,
                        positionMs: self.currentPositionMs()
                    )
                }
            }
        )
    }

    private func removePlaybackObservers() {
        if let periodicObserver, let player {
            player.removeTimeObserver(periodicObserver)
        }
        periodicObserver = nil
        for observer in notificationObservers {
            NotificationCenter.default.removeObserver(observer)
        }
        notificationObservers.removeAll()
    }

    private func checkpoint(_ time: CMTime, forceProgressSave: Bool = false) async {
        guard let playback else { return }
        let seconds = CMTimeGetSeconds(time)
        guard seconds.isFinite, seconds >= 0 else { return }
        let positionMs = max(0, Int(seconds * 1_000))

        let now = Date()
        let deltaMs = max(
            0,
            min(
                60_000,
                lastAnalyticsAt.map { Int(now.timeIntervalSince($0) * 1_000) } ?? 0
            )
        )
        lastAnalyticsAt = now

        if deltaMs > 0 {
            await emit(
                playback.isLive ? "LIVE_DURATION" : "VIDEO_PROGRESS",
                playback: playback,
                durationDeltaMs: deltaMs,
                positionMs: positionMs
            )
        }

        guard
            !playback.isLive,
            let token = sessionToken,
            let videoId = playback.videoId
        else { return }

        let shouldSave =
            forceProgressSave ||
            lastSavedPositionMs == nil ||
            abs(positionMs - (lastSavedPositionMs ?? 0)) >= 5_000
        guard shouldSave else { return }

        do {
            try await progressService.save(
                videoId: videoId,
                profileId: profileId,
                positionMs: positionMs,
                durationMs: resolvedDurationMs(playback),
                token: token
            )
            lastSavedPositionMs = positionMs
        } catch {
            // Progress persistence must never stop media playback.
        }
    }

    private func emit(
        _ eventName: String,
        playback: NativePlayback,
        durationDeltaMs: Int? = nil,
        positionMs: Int? = nil,
        metadata: [String: String] = [:]
    ) async {
        var eventMetadata = metadata
        eventMetadata["protocol"] = playback.protocolName
        if playback.isKids {
            eventMetadata["kids"] = "true"
        }
        await analytics.emit(
            eventName,
            profileId: profileId,
            videoId: playback.videoId,
            channelId: playback.channelId,
            durationDeltaMs: durationDeltaMs,
            positionMs: positionMs,
            metadata: eventMetadata
        )
    }

    private func currentPositionMs() -> Int? {
        guard let player else { return nil }
        let seconds = CMTimeGetSeconds(player.currentTime())
        guard seconds.isFinite, seconds >= 0 else { return nil }
        return Int(seconds * 1_000)
    }

    private func resolvedDurationMs(_ playback: NativePlayback) -> Int? {
        if let durationMs = playback.durationMs, durationMs > 0 { return durationMs }
        guard let duration = player?.currentItem?.duration else { return nil }
        let seconds = CMTimeGetSeconds(duration)
        guard seconds.isFinite, seconds > 0 else { return nil }
        return Int(seconds * 1_000)
    }

    private func seek(_ player: AVPlayer, toMilliseconds positionMs: Int) async {
        let time = CMTime(seconds: Double(max(0, positionMs)) / 1_000, preferredTimescale: 600)
        await withCheckedContinuation { continuation in
            player.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero) { _ in
                continuation.resume()
            }
        }
    }

    private func configureAudioSession() throws {
        let audio = AVAudioSession.sharedInstance()
        try audio.setCategory(.playback, mode: .moviePlayback, options: [.allowAirPlay])
        try audio.setActive(true)
    }
}
