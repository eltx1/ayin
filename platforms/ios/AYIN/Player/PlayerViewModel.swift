import AVFoundation
import Combine
import Foundation

@MainActor
final class PlayerViewModel: ObservableObject {
    @Published private(set) var player: AVPlayer?
    @Published private(set) var playback: NativePlayback?
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?
    @Published private(set) var progressNeedsReview = false
    @Published private(set) var isReviewingProgress = false

    let destination: PlayerDestination

    private let service: any PlaybackServicing
    private let progressService: any WatchProgressServicing
    private let analytics: any AnalyticsTracking

    private var sessionToken: String?
    private var accountId: String?
    private var profileId: String?
    private var viewerIsKids = false
    private var shouldResumeAfterInterruption = false
    private var periodicObserver: Any?
    private var notificationObservers: [NSObjectProtocol] = []
    private var timeControlObservation: NSKeyValueObservation?
    private var checkpointTask: Task<Void, Never>?
    private var checkpointWorkerID: UUID?
    private var pendingCheckpoint: PlaybackCheckpoint?
    private var initialAnalyticsTask: Task<Void, Never>?
    private var startupMetricTask: Task<Void, Never>?
    private var resumeTask: Task<Void, Never>?
    private var playAttemptStartedAt: Date?
    private var startupReported = false
    private var lastAnalyticsPositionMs: Int?
    private var finalDurationMs: Int?
    private var progressState = ProgressRevisionState()
    private var loadGeneration: UInt64 = 0
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

    func load(token: String?, profileId: String?, accountId: String? = nil, isKids: Bool = false) async {
        guard !Task.isCancelled else { return }
        viewerDidChange(token: token, accountId: accountId, profileId: profileId, isKids: isKids)
        guard player == nil, !isLoading else { return }
        loadGeneration &+= 1
        let generation = loadGeneration
        isLoading = true
        errorMessage = nil
        sessionToken = token
        self.accountId = accountId
        self.profileId = profileId
        viewerIsKids = isKids
        defer { if loadGeneration == generation { isLoading = false } }

        do {
            let playback = try await service.load(destination, token: token, accountId: accountId,
                                                  profileId: profileId, isKids: isKids)
            try Task.checkCancellation()
            guard loadGeneration == generation else { return }
            try configureAudioSession()

            let item = AVPlayerItem(url: playback.sourceURL)
            let player = AVPlayer(playerItem: item)
            player.automaticallyWaitsToMinimizeStalling = true
            player.allowsExternalPlayback = true

            self.playback = playback
            self.player = player
            lastAnalyticsPositionMs = currentPositionMs()
            startupReported = false
            progressState.reset()
            progressNeedsReview = false
            installPlaybackObservers(player: player, item: item)

            // Schedule analytics first so event ordering is stable, but never await its I/O.
            dispatchInitialAnalytics(for: playback)
            playAttemptStartedAt = Date()
            player.play()

            // Authenticated resume lookup is deliberately off the startup critical path.
            loadResumePositionIfUseful(
                player: player,
                playback: playback,
                token: token,
                profileId: profileId
            )
        } catch is CancellationError {
            return
        } catch {
            guard loadGeneration == generation else { return }
            errorMessage = error.localizedDescription
            let message = String(error.localizedDescription.prefix(200))
            Task { @MainActor [weak self] in
                guard let self, self.loadGeneration == generation else { return }
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

    func viewerDidChange(token: String?, accountId: String?, profileId: String?, isKids: Bool) {
        guard sessionToken != token || self.accountId != accountId || self.profileId != profileId ||
                viewerIsKids != isKids else { return }
        invalidateViewer()
    }

    // Session publishers invoke this synchronously, before a replacement load can suspend.
    // It also revokes held responses and removes media from PiP/AirPlay immediately.
    func invalidateViewer() {
        loadGeneration &+= 1
        isLoading = false
        player?.pause()
        removePlaybackObservers()
        resumeTask?.cancel()
        resumeTask = nil
        initialAnalyticsTask?.cancel()
        initialAnalyticsTask = nil
        startupMetricTask?.cancel()
        startupMetricTask = nil
        checkpointTask?.cancel()
        clearPlayback()
        errorMessage = nil
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

    @discardableResult
    func stop(saveProgress: Bool = true) async -> Bool {
        loadGeneration &+= 1
        let generation = loadGeneration
        isLoading = false
        let finalTime = player?.currentTime()
        finalDurationMs = playback.flatMap { resolvedDurationMs($0) }
        player?.pause()
        shouldResumeAfterInterruption = false

        resumeTask?.cancel()
        resumeTask = nil
        initialAnalyticsTask?.cancel()
        initialAnalyticsTask = nil
        startupMetricTask?.cancel()
        startupMetricTask = nil

        // Stop new periodic work before appending the final checkpoint.
        removePlaybackObservers()

        var checkpointToAwait = checkpointTask
        if saveProgress, let finalTime {
            checkpointToAwait = enqueueCheckpoint(
                finalTime,
                forceProgressSave: true
            ) ?? checkpointToAwait
        }

        // Release media and the audio session before checkpoint I/O can suspend.
        // A late acknowledgment must not deactivate a newly opened player's audio.
        if let player {
            player.replaceCurrentItem(with: nil)
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
        if !saveProgress {
            checkpointTask?.cancel()
            checkpointWorkerID = nil
            progressState.reset()
        } else if let checkpointToAwait {
            await checkpointToAwait.value
        }

        guard loadGeneration == generation else { return false }

        clearPlayback(deactivateAudio: false)
        return true
    }

    private func clearPlayback(deactivateAudio: Bool = true) {
        checkpointTask = nil
        checkpointWorkerID = nil
        pendingCheckpoint = nil

        player?.replaceCurrentItem(with: nil)
        player = nil
        playback = nil
        sessionToken = nil
        accountId = nil
        profileId = nil
        viewerIsKids = false
        playAttemptStartedAt = nil
        startupReported = false
        lastAnalyticsPositionMs = nil
        finalDurationMs = nil
        progressState.reset()
        progressNeedsReview = false
        isReviewingProgress = false
        didComplete = false
        shouldResumeAfterInterruption = false
        if deactivateAudio {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    private func installPlaybackObservers(player: AVPlayer, item: AVPlayerItem) {
        removePlaybackObservers()
        let generation = loadGeneration

        periodicObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 15, preferredTimescale: 600),
            queue: .main
        ) { [weak self, weak player, weak item] time in
            Task { @MainActor [weak self, weak player, weak item] in
                guard let self, self.ownsPlayback(player, item: item, generation: generation) else { return }
                _ = self.enqueueCheckpoint(time)
            }
        }

        timeControlObservation = player.observe(\.timeControlStatus, options: [.new]) {
            [weak self, weak item] observedPlayer, _ in
            Task { @MainActor [weak self, weak item] in
                guard let self, self.ownsPlayback(observedPlayer, item: item, generation: generation),
                      observedPlayer.timeControlStatus == .playing else { return }
                self.reportStartupIfNeeded()
            }
        }

        let center = NotificationCenter.default
        notificationObservers.append(
            center.addObserver(
                forName: AVPlayerItem.playbackStalledNotification,
                object: item,
                queue: .main
            ) { [weak self, weak player, weak item] _ in
                Task { @MainActor [weak self, weak player, weak item] in
                    guard let self, self.ownsPlayback(player, item: item, generation: generation),
                          let playback = self.playback else { return }
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
            ) { [weak self, weak player, weak item] notification in
                Task { @MainActor [weak self, weak player, weak item] in
                    guard let self, self.ownsPlayback(player, item: item, generation: generation),
                          let playback = self.playback else { return }
                    let error = notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
                    await self.handleAsynchronousPlaybackFailure(playback: playback, error: error)
                }
            }
        )

        notificationObservers.append(
            center.addObserver(
                forName: AVPlayerItem.timeJumpedNotification,
                object: item,
                queue: .main
            ) { [weak self, weak player, weak item] _ in
                Task { @MainActor [weak self, weak player, weak item] in
                    guard let self, self.ownsPlayback(player, item: item, generation: generation) else { return }
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
            ) { [weak self, weak player, weak item] _ in
                Task { @MainActor [weak self, weak player, weak item] in
                    guard let self, self.ownsPlayback(player, item: item, generation: generation),
                          !self.didComplete, let playback = self.playback else { return }
                    self.didComplete = true
                    if let player = self.player,
                       let checkpoint = self.enqueueCheckpoint(
                           player.currentTime(),
                           forceProgressSave: true
                       ) {
                        await checkpoint.value
                    }
                    guard self.ownsPlayback(player, item: item, generation: generation) else { return }
                    await self.emit(
                        playback.isLive ? "LIVE_PLAY_COMPLETE" : "VIDEO_COMPLETE",
                        playback: playback,
                        positionMs: self.currentPositionMs()
                    )
                }
            }
        )
    }

    private func ownsPlayback(_ player: AVPlayer?, item: AVPlayerItem?, generation: UInt64) -> Bool {
        guard let player, let item else { return false }
        return loadGeneration == generation && self.player === player && player.currentItem === item
    }

    private func removePlaybackObservers() {
        if let periodicObserver, let player {
            player.removeTimeObserver(periodicObserver)
        }
        periodicObserver = nil
        timeControlObservation?.invalidate()
        timeControlObservation = nil
        for observer in notificationObservers {
            NotificationCenter.default.removeObserver(observer)
        }
        notificationObservers.removeAll()
    }

    private func dispatchInitialAnalytics(for playback: NativePlayback) {
        initialAnalyticsTask?.cancel()
        initialAnalyticsTask = Task { @MainActor [weak self] in
            guard let self, !Task.isCancelled else { return }
            if playback.isLive {
                await self.emit("LIVE_PAGE_VIEW", playback: playback)
                guard !Task.isCancelled else { return }
                await self.emit("LIVE_PLAY_START", playback: playback)
            } else {
                await self.emit("VIDEO_START", playback: playback)
            }
        }
    }

    private func reportStartupIfNeeded() {
        guard
            !startupReported,
            let playback,
            let playAttemptStartedAt
        else { return }

        startupReported = true
        let startupMs = max(
            0,
            min(3_600_000, Int(Date().timeIntervalSince(playAttemptStartedAt) * 1_000))
        )
        let initialTask = initialAnalyticsTask

        startupMetricTask?.cancel()
        startupMetricTask = Task { @MainActor [weak self] in
            await initialTask?.value
            guard let self, !Task.isCancelled else { return }
            await self.emit(
                playback.isLive ? "LIVE_STARTUP" : "VIDEO_STARTUP",
                playback: playback,
                durationDeltaMs: startupMs
            )
        }
    }

    private func loadResumePositionIfUseful(
        player: AVPlayer,
        playback: NativePlayback,
        token: String?,
        profileId: String?,
        allowResume: Bool = true
    ) {
        resumeTask?.cancel()
        guard
            !playback.isLive,
            let token,
            let videoId = playback.videoId
        else { return }

        let ticket = progressState.beginRead()
        isReviewingProgress = true

        resumeTask = Task { @MainActor [weak self, weak player] in
            guard let self, let player else { return }
            do {
                let progress = try await self.progressService.progress(
                    videoId: videoId,
                    profileId: profileId,
                    token: token
                )
                guard !Task.isCancelled, self.player === player else { return }

                // From this point forward we know the authoritative server baseline and can
                // persist only forward progress without accidentally moving Continue Watching back.
                guard self.progressState.accept(progress, for: ticket) else { return }
                self.progressNeedsReview = false
                self.isReviewingProgress = false

                guard
                    allowResume,
                    progress.completedAt == nil,
                    progress.positionMs > 0,
                    (self.currentPositionMs() ?? 0) <= 2_500
                else { return }

                await self.seek(player, toMilliseconds: progress.positionMs)
                guard !Task.isCancelled, self.player === player else { return }
                self.lastAnalyticsPositionMs = progress.positionMs
            } catch is CancellationError {
                return
            } catch {
                // A transient progress failure must not delay playback or risk overwriting
                // an unknown server position with a lower local value.
                guard !Task.isCancelled, self.player === player,
                      self.progressState.fail(ticket) else { return }
                self.progressNeedsReview = true
                self.isReviewingProgress = false
            }
        }
    }

    func reviewProgress() {
        guard !isReviewingProgress, let player, let playback else { return }
        loadResumePositionIfUseful(
            player: player,
            playback: playback,
            token: sessionToken,
            profileId: profileId,
            allowResume: false
        )
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

        let workerID = UUID()
        checkpointWorkerID = workerID
        let worker = Task { @MainActor [weak self] in
            guard let self else { return }
            while !Task.isCancelled, self.checkpointWorkerID == workerID {
                guard let checkpoint = self.pendingCheckpoint else { break }
                self.pendingCheckpoint = nil
                await self.performCheckpoint(
                    positionMs: checkpoint.positionMs,
                    forceProgressSave: checkpoint.forceProgressSave
                )
            }
            if self.checkpointWorkerID == workerID {
                self.checkpointTask = nil
                self.checkpointWorkerID = nil
            }
        }
        checkpointTask = worker
        return worker
    }

    private func performCheckpoint(
        positionMs: Int,
        forceProgressSave: Bool
    ) async {
        guard let playback else { return }
        let generation = loadGeneration

        let durationDeltaMs = PlaybackAccounting.watchedDeltaMs(
            previousPositionMs: lastAnalyticsPositionMs,
            currentPositionMs: positionMs
        )
        lastAnalyticsPositionMs = positionMs

        if durationDeltaMs > 0 {
            Task { @MainActor [weak self] in
                guard let self, self.loadGeneration == generation else { return }
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
            let videoId = playback.videoId,
            let baseline = progressState.snapshot,
            !Task.isCancelled
        else { return }

        if positionMs < baseline.positionMs {
            return
        }

        let shouldSave =
            forceProgressSave ||
            positionMs - baseline.positionMs >= 5_000
        guard shouldSave, let ticket = progressState.beginSave(positionMs: positionMs) else { return }

        do {
            let saved = try await progressService.save(
                videoId: videoId,
                profileId: profileId,
                positionMs: positionMs,
                durationMs: resolvedDurationMs(playback),
                expectedRevision: ticket.expectedRevision,
                token: token
            )
            guard !Task.isCancelled, progressState.accept(saved, for: ticket) else { return }
            progressNeedsReview = false
        } catch {
            // An unknown acknowledgment may already have committed. A 409 may be
            // another device's newer progress. Neither outcome authorizes replay.
            guard !Task.isCancelled, progressState.fail(ticket) else { return }
            progressNeedsReview = true
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
        if let finalDurationMs { return finalDurationMs }
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

    func retry(token: String?, profileId: String?, accountId: String? = nil, isKids: Bool = false) async {
        // A newer identity may load while the old final checkpoint is awaiting I/O.
        guard await stop(), !Task.isCancelled else { return }
        errorMessage = nil
        await load(token: token, profileId: profileId, accountId: accountId, isKids: isKids)
    }

    private func handleAsynchronousPlaybackFailure(
        playback failedPlayback: NativePlayback,
        error: Error?
    ) async {
        let generation = loadGeneration
        if let fallbackPlayback = failedPlayback.usingMP4Fallback(), let player {
            let resumePositionMs = currentPositionMs() ?? 0

            removePlaybackObservers()
            let fallbackItem = AVPlayerItem(url: fallbackPlayback.sourceURL)
            player.replaceCurrentItem(with: fallbackItem)
            playback = fallbackPlayback
            lastAnalyticsPositionMs = resumePositionMs
            installPlaybackObservers(player: player, item: fallbackItem)

            if resumePositionMs > 0 {
                await seek(player, toMilliseconds: resumePositionMs)
            }
            guard ownsPlayback(player, item: fallbackItem, generation: generation) else { return }
            player.play()

            Task { @MainActor [weak self, weak player, weak fallbackItem] in
                guard let self, self.ownsPlayback(player, item: fallbackItem, generation: generation) else { return }
                await self.emit(
                    "VIDEO_HLS_FATAL",
                    playback: failedPlayback,
                    positionMs: resumePositionMs,
                    metadata: [
                        "message": String((error?.localizedDescription ?? "HLS playback failed").prefix(200))
                    ]
                )
                guard self.ownsPlayback(player, item: fallbackItem, generation: generation) else { return }
                await self.emit(
                    "VIDEO_FALLBACK",
                    playback: fallbackPlayback,
                    positionMs: resumePositionMs,
                    metadata: ["from": "HLS", "to": "MP4"]
                )
            }
            return
        }

        let failurePosition = player?.currentTime()
        let position = currentPositionMs()
        let message = error?.localizedDescription ?? "Playback failed."

        resumeTask?.cancel()
        resumeTask = nil
        player?.pause()
        removePlaybackObservers()
        if let failurePosition {
            _ = enqueueCheckpoint(failurePosition, forceProgressSave: true)
        }
        player?.replaceCurrentItem(with: nil)
        player = nil
        errorMessage = error?.localizedDescription ?? NSLocalizedString("Playback failed.", comment: "Playback error")

        Task { @MainActor [weak self] in
            guard let self, self.loadGeneration == generation else { return }
            await self.emit(
                failedPlayback.isLive ? "LIVE_FATAL_ERROR" :
                    (failedPlayback.protocolName == "HLS" ? "VIDEO_HLS_FATAL" : "VIDEO_BUFFER"),
                playback: failedPlayback,
                positionMs: position,
                metadata: [
                    "protocol": failedPlayback.protocolName,
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
