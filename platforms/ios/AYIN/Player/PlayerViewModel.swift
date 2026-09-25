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
    private var checkpointTask: Task<Void, Never>?
    private var pendingCheckpoint: PlaybackCheckpoint?
    private var startupAnalyticsTask: Task<Void, Never>?
    private var lastAnalyticsPositionMs: Int?
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
            try Task.checkCancellation()
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

            try Task.checkCancellation()
            lastAnalyticsPositionMs = currentPositionMs()
            installPlaybackObservers(player: player, item: item)

            // Media startup must never wait on best-effort analytics I/O.
            player.play()

            let startupMs = max(
                0,
                min(3_600_000, Int(Date().timeIntervalSince(loadStartedAt) * 1_000))
            )
            startupAnalyticsTask?.cancel()
            startupAnalyticsTask = Task { @MainActor [weak self] in
                guard let self, !Task.isCancelled else { return }
                if playback.isLive {
                    await self.emit("LIVE_PAGE_VIEW", playback: playback)
                    guard !Task.isCancelled else { return }
                    await self.emit("LIVE_PLAY_START", playback: playback)
                    guard !Task.isCancelled else { return }
                    await self.emit(
                        "LIVE_STARTUP",
                        playback: playback,
                        durationDeltaMs: startupMs
                    )
                } else {
                    await self.emit("VIDEO_START", playback: playback)
                    guard !Task.isCancelled else { return }
                    await self.emit(
                        "VIDEO_STARTUP",
                        playback: playback,
                        durationDeltaMs: startupMs
                    )
                }
            }
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
            let message = String(error.localizedDescription.prefix(200))
            Task { @MainActor [weak self] in
                guard let self else { return }
                await self.analytics.emit(
                    self.destination.kind == .live ? "LIVE_FATAL_ERROR" : "VIDEO_BUFFER",
                    profileId: self.profileId,
                    videoId: nil,
                    channelId: nil,
                    durationDeltaMs: nil,
                    positionMs: nil,
                    metadata: [
                        "stage": "load",
                        "slug": self.destination.slug,
                        "message": message
                    ]
                )
            }
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
        let finalTime = player?.currentTime()
        player?.pause()

        // Stop new periodic work before appending the final checkpoint.
        removePlaybackObservers()

        if let finalTime, let finalCheckpoint = enqueueCheckpoint(
            finalTime,
            forceProgressSave: true
        ) {
            await finalCheckpoint.value
        }

        startupAnalyticsTask?.cancel()
        startupAnalyticsTask = nil
        checkpointTask = nil
        pendingCheckpoint = nil

        player?.replaceCurrentItem(with: nil)
        player = nil
        playback = nil
        sessionToken = nil
        profileId = nil
        lastAnalyticsPositionMs = nil
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
                _ = self?.enqueueCheckpoint(time)
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
                    self.handleAsynchronousPlaybackFailure(playback: playback, error: error)
                }
            }
        )

        notificationObservers.append(
            center.addObserver(
                forName: AVPlayerItem.timeJumpedNotification,
                object: item,
                queue: .main
            ) { [weak self] _ in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    // A seek is not watched duration. Reset the accounting baseline.
                    self.lastAnalyticsPositionMs = self.currentPositionMs()
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
                    if let player = self.player,
                       let checkpoint = self.enqueueCheckpoint(
                           player.currentTime(),
                           forceProgressSave: true
                       ) {
                        await checkpoint.value
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

    @discardableResult
    private func enqueueCheckpoint(
        _ time: CMTime,
        forceProgressSave: Bool = false
    ) -> Task<Void, Never>? {
        guard let positionMs = positionMs(time) else { return nil }

        pendingCheckpoint = PlaybackAccounting.coalescedCheckpoint(
            existing: pendingCheckpoint,
            positionMs: positionMs,
            forceProgressSave: forceProgressSave
        )

        if let checkpointTask {
            return checkpointTask
        }

        let worker = Task { @MainActor [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                guard let checkpoint = self.pendingCheckpoint else { break }
                self.pendingCheckpoint = nil
                await self.performCheckpoint(
                    positionMs: checkpoint.positionMs,
                    forceProgressSave: checkpoint.forceProgressSave
                )
            }
            self.checkpointTask = nil
        }
        checkpointTask = worker
        return worker
    }

    private func performCheckpoint(
        positionMs: Int,
        forceProgressSave: Bool
    ) async {
        guard let playback else { return }

        let durationDeltaMs = PlaybackAccounting.watchedDeltaMs(
            previousPositionMs: lastAnalyticsPositionMs,
            currentPositionMs: positionMs
        )
        lastAnalyticsPositionMs = positionMs

        if durationDeltaMs > 0 {
            Task { @MainActor [weak self] in
                guard let self else { return }
                await self.emit(
                    playback.isLive ? "LIVE_DURATION" : "VIDEO_PROGRESS",
                    playback: playback,
                    durationDeltaMs: durationDeltaMs,
                    positionMs: positionMs
                )
            }
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
        return positionMs(player.currentTime())
    }

    private func positionMs(_ time: CMTime) -> Int? {
        let seconds = CMTimeGetSeconds(time)
        guard seconds.isFinite, seconds >= 0 else { return nil }
        return max(0, Int(seconds * 1_000))
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

    func retry(token: String?, profileId: String?) async {
        await stop()
        errorMessage = nil
        await load(token: token, profileId: profileId)
    }

    private func handleAsynchronousPlaybackFailure(
        playback: NativePlayback,
        error: Error?
    ) {
        let failurePosition = player?.currentTime()
        let position = currentPositionMs()
        let message = error?.localizedDescription ?? "Playback failed."

        player?.pause()
        removePlaybackObservers()
        if let failurePosition {
            _ = enqueueCheckpoint(failurePosition, forceProgressSave: true)
        }
        player?.replaceCurrentItem(with: nil)
        player = nil
        errorMessage = message

        Task { @MainActor [weak self] in
            guard let self else { return }
            await self.emit(
                playback.isLive ? "LIVE_FATAL_ERROR" :
                    (playback.protocolName == "HLS" ? "VIDEO_HLS_FATAL" : "VIDEO_BUFFER"),
                playback: playback,
                positionMs: position,
                metadata: [
                    "protocol": playback.protocolName,
                    "message": String(message.prefix(200))
                ]
            )
        }
    }

    private func configureAudioSession() throws {
        let audio = AVAudioSession.sharedInstance()
        try audio.setCategory(.playback, mode: .moviePlayback, options: [.allowAirPlay])
        try audio.setActive(true)
    }
}
