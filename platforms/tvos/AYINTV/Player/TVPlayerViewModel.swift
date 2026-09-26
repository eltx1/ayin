import AVFoundation
import Combine
import Foundation

@MainActor
final class TVPlayerViewModel: ObservableObject {
    @Published private(set) var player: AVPlayer?
    @Published private(set) var playback: TVPlaybackAsset?
    @Published private(set) var captionTracks: [TVCaptionTrack] = []
    @Published private(set) var selectedCaptionId: String?
    @Published private(set) var subtitleText = ""
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?

    let destination: TVPlaybackDestination

    private let service: any TVPlaybackServicing
    private let progress: any WatchProgressServicing
    private let analytics: any TVAnalyticsTracking
    private let session: URLSession

    private var token: String?
    private var profileId: String?
    private var periodicObserver: Any?
    private var subtitleObserver: Any?
    private var notificationObservers: [NSObjectProtocol] = []
    private var timeControlObservation: NSKeyValueObservation?
    private var resumeTask: Task<Void, Never>?
    private var startupTask: Task<Void, Never>?
    private var checkpointTask: Task<Void, Never>?
    private var pendingCheckpoint: PlaybackCheckpoint?
    private var cuesByTrack: [String: [TVCaptionCue]] = [:]
    private var lastAnalyticsPositionMs: Int?
    private var lastSavedPositionMs: Int?
    private var progressBaselineResolved = false
    private var playAttemptStartedAt: Date?
    private var startupReported = false
    private var sceneResumeState = TVSceneResumeState()
    private var sceneIsActive = true
    private var pictureInPictureActive = false
    private var userNavigatedDuringStartup = false

    init(
        destination: TVPlaybackDestination,
        service: any TVPlaybackServicing = TVPlaybackService(),
        progress: any WatchProgressServicing = WatchProgressService(),
        analytics: any TVAnalyticsTracking = TVAnalyticsClient(),
        session: URLSession = .shared
    ) {
        self.destination = destination
        self.service = service
        self.progress = progress
        self.analytics = analytics
        self.session = session
    }

    func load(token: String?, profileId: String?) async {
        guard player == nil, !isLoading else { return }
        isLoading = true
        errorMessage = nil
        self.token = token
        self.profileId = profileId
        userNavigatedDuringStartup = false
        defer { isLoading = false }

        do {
            let playback = try await service.load(destination)
            try Task.checkCancellation()

            let item = AVPlayerItem(url: playback.primaryURL)
            let player = AVPlayer(playerItem: item)
            player.automaticallyWaitsToMinimizeStalling = true

            self.playback = playback
            self.player = player
            captionTracks = playback.captions
            lastAnalyticsPositionMs = playback.initialOffsetMs
            progressBaselineResolved = token == nil || playback.isLive || playback.videoId == nil
            installObservers(player: player, item: item)

            if playback.initialOffsetMs > 0 {
                await seek(player, toMilliseconds: playback.initialOffsetMs)
            }

            dispatchStartAnalytics(playback)
            playAttemptStartedAt = Date()
            player.play()

            if let defaultTrack = playback.captions.first(where: { $0.isDefault }) {
                Task { @MainActor [weak self] in
                    await self?.selectCaption(defaultTrack.id)
                }
            }

            loadResumePosition(player: player, playback: playback)
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func retry() async {
        let currentToken = token
        let currentProfile = profileId
        await stop()
        await load(token: currentToken, profileId: currentProfile)
    }

    func selectCaption(_ id: String?) async {
        selectedCaptionId = id
        subtitleText = ""
        guard
            let id,
            let track = captionTracks.first(where: { $0.id == id })
        else { return }

        if cuesByTrack[id] == nil {
            guard let url = MediaURLBuilder.url(objectKey: track.objectKey) else { return }
            do {
                let (data, response) = try await session.data(from: url)
                guard
                    let http = response as? HTTPURLResponse,
                    (200..<300).contains(http.statusCode),
                    let source = String(data: data, encoding: .utf8)
                else { return }
                cuesByTrack[id] = TVWebVTT.parse(source)
            } catch {
                return
            }
        }
        refreshSubtitle()
    }

    func handleScene(active: Bool) {
        sceneIsActive = active
        guard let player else { return }

        if active {
            if sceneResumeState.enterActive() {
                player.play()
            }
            return
        }

        guard TVPlaybackScenePolicy.shouldPause(
            sceneIsActive: sceneIsActive,
            pictureInPictureActive: pictureInPictureActive
        ) else { return }
        pauseForSceneDeparture(player)
    }

    func setPictureInPictureActive(_ active: Bool) {
        pictureInPictureActive = active
        guard
            TVPlaybackScenePolicy.shouldPause(
                sceneIsActive: sceneIsActive,
                pictureInPictureActive: pictureInPictureActive
            ),
            let player
        else { return }
        pauseForSceneDeparture(player)
    }

    func noteUserNavigation(to time: CMTime) {
        userNavigatedDuringStartup = true
        lastAnalyticsPositionMs = positionMs(time)
    }

    private func pauseForSceneDeparture(_ player: AVPlayer) {
        let shouldResumePlayback = player.timeControlStatus != .paused
        guard sceneResumeState.leaveActive(
            shouldResumePlayback: shouldResumePlayback
        ) else {
            return
        }
        player.pause()
        _ = enqueueCheckpoint(player.currentTime(), forceProgressSave: true)
    }

    func stop() async {
        resumeTask?.cancel()
        resumeTask = nil
        startupTask?.cancel()
        startupTask = nil

        if let player {
            player.pause()
            _ = enqueueCheckpoint(player.currentTime(), forceProgressSave: true)
        }
        if let checkpointTask { await checkpointTask.value }

        removeObservers()
        checkpointTask = nil
        pendingCheckpoint = nil
        player?.replaceCurrentItem(with: nil)
        player = nil
        playback = nil
        captionTracks = []
        selectedCaptionId = nil
        subtitleText = ""
        cuesByTrack.removeAll()
        token = nil
        profileId = nil
        lastAnalyticsPositionMs = nil
        lastSavedPositionMs = nil
        progressBaselineResolved = false
        playAttemptStartedAt = nil
        startupReported = false
        sceneResumeState.reset()
        sceneIsActive = true
        pictureInPictureActive = false
        userNavigatedDuringStartup = false
    }

    private func installObservers(player: AVPlayer, item: AVPlayerItem) {
        removeObservers()

        periodicObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 15, preferredTimescale: 600),
            queue: .main
        ) { [weak self] time in
            Task { @MainActor [weak self] in
                _ = self?.enqueueCheckpoint(time)
            }
        }

        subtitleObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.25, preferredTimescale: 600),
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in self?.refreshSubtitle() }
        }

        timeControlObservation = player.observe(\.timeControlStatus, options: [.new]) {
            [weak self] observed, _ in
            Task { @MainActor [weak self] in
                guard let self, observed.timeControlStatus == .playing else { return }
                self.reportStartupIfNeeded()
            }
        }

        let center = NotificationCenter.default
        notificationObservers.append(
            center.addObserver(
                forName: AVPlayerItem.failedToPlayToEndTimeNotification,
                object: item,
                queue: .main
            ) { [weak self] note in
                Task { @MainActor [weak self] in
                    guard let self, let playback = self.playback else { return }
                    let error = note.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
                    await self.handleFailure(playback: playback, error: error)
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
                    guard let self, let playback = self.playback else { return }
                    await self.handleSuccessfulCompletion(playback: playback)
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
                    self.lastAnalyticsPositionMs = self.currentPositionMs()
                }
            }
        )
    }

    private func removeObservers() {
        if let periodicObserver, let player { player.removeTimeObserver(periodicObserver) }
        if let subtitleObserver, let player { player.removeTimeObserver(subtitleObserver) }
        periodicObserver = nil
        subtitleObserver = nil
        timeControlObservation?.invalidate()
        timeControlObservation = nil
        for observer in notificationObservers {
            NotificationCenter.default.removeObserver(observer)
        }
        notificationObservers.removeAll()
    }

    private func dispatchStartAnalytics(_ playback: TVPlaybackAsset) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            await self.emit(playback.isLive ? "LIVE_PLAY_START" : "VIDEO_START", playback: playback)
        }
    }

    private func reportStartupIfNeeded() {
        guard
            !startupReported,
            let playback,
            let started = playAttemptStartedAt
        else { return }
        startupReported = true
        let ms = max(0, min(3_600_000, Int(Date().timeIntervalSince(started) * 1_000)))
        startupTask?.cancel()
        startupTask = Task { @MainActor [weak self] in
            guard let self else { return }
            await self.emit(
                playback.isLive ? "LIVE_STARTUP" : "VIDEO_STARTUP",
                playback: playback,
                durationDeltaMs: ms
            )
        }
    }

    private func loadResumePosition(player: AVPlayer, playback: TVPlaybackAsset) {
        guard
            !playback.isLive,
            let token,
            let videoId = playback.videoId
        else { return }

        resumeTask?.cancel()
        resumeTask = Task { @MainActor [weak self, weak player] in
            guard let self, let player else { return }
            do {
                let state = try await self.progress.progress(
                    videoId: videoId,
                    profileId: self.profileId,
                    token: token
                )
                guard !Task.isCancelled, self.player === player else { return }
                self.progressBaselineResolved = true

                if TVResumePolicy.shouldApplySavedPosition(
                    positionMs: state.positionMs,
                    completedAt: state.completedAt,
                    userNavigated: self.userNavigatedDuringStartup
                ) {
                    await self.seek(player, toMilliseconds: state.positionMs)
                    self.lastSavedPositionMs = state.positionMs
                    self.lastAnalyticsPositionMs = state.positionMs
                } else {
                    self.lastSavedPositionMs = self.currentPositionMs()
                }
            } catch {
                self.progressBaselineResolved = false
            }
        }
    }

    @discardableResult
    private func enqueueCheckpoint(
        _ time: CMTime,
        forceProgressSave: Bool = false
    ) -> Task<Void, Never>? {
        guard let position = positionMs(time) else { return nil }
        pendingCheckpoint = PlaybackAccounting.coalescedCheckpoint(
            existing: pendingCheckpoint,
            positionMs: position,
            forceProgressSave: forceProgressSave
        )
        if let checkpointTask { return checkpointTask }

        let worker = Task { @MainActor [weak self] in
            guard let self else { return }
            while let checkpoint = self.pendingCheckpoint, !Task.isCancelled {
                self.pendingCheckpoint = nil
                await self.performCheckpoint(checkpoint)
            }
            self.checkpointTask = nil
        }
        checkpointTask = worker
        return worker
    }

    private func performCheckpoint(_ checkpoint: PlaybackCheckpoint) async {
        guard let playback else { return }
        let watched = PlaybackAccounting.watchedDeltaMs(
            previousPositionMs: lastAnalyticsPositionMs,
            currentPositionMs: checkpoint.positionMs
        )
        lastAnalyticsPositionMs = checkpoint.positionMs

        if watched > 0 {
            Task { @MainActor [weak self] in
                guard let self else { return }
                await self.emit(
                    playback.isLive ? "LIVE_DURATION" : "VIDEO_PROGRESS",
                    playback: playback,
                    durationDeltaMs: watched,
                    positionMs: checkpoint.positionMs
                )
            }
        }

        guard !playback.isLive else { return }

        if !progressBaselineResolved {
            await retryProgressBaseline(playback: playback)
        }

        guard
            progressBaselineResolved,
            let token,
            let videoId = playback.videoId
        else { return }

        guard TVProgressPersistence.shouldSave(
            lastSavedPositionMs: lastSavedPositionMs,
            currentPositionMs: checkpoint.positionMs,
            force: checkpoint.forceProgressSave
        ) else { return }

        do {
            try await progress.save(
                videoId: videoId,
                profileId: profileId,
                positionMs: checkpoint.positionMs,
                durationMs: playback.durationMs,
                token: token
            )
            lastSavedPositionMs = checkpoint.positionMs
        } catch {
            // Progress persistence is best-effort.
        }
    }

    private func retryProgressBaseline(playback: TVPlaybackAsset) async {
        guard
            !playback.isLive,
            let token,
            let videoId = playback.videoId
        else { return }

        do {
            let state = try await progress.progress(
                videoId: videoId,
                profileId: profileId,
                token: token
            )
            progressBaselineResolved = true
            lastSavedPositionMs = state.positionMs
        } catch {
            progressBaselineResolved = false
        }
    }

    private func handleSuccessfulCompletion(playback finished: TVPlaybackAsset) async {
        let position = currentPositionMs() ?? finished.durationMs ?? 0

        switch TVPlaybackLifecycle.completionAction(for: destination) {
        case .finalizeVOD:
            if let player {
                let finalCheckpoint = enqueueCheckpoint(
                    player.currentTime(),
                    forceProgressSave: true
                )
                await finalCheckpoint?.value
            }
            await emit(
                "VIDEO_COMPLETE",
                playback: finished,
                positionMs: position
            )

        case .reloadCurrentDestination:
            await emit(
                "LIVE_PLAY_COMPLETE",
                playback: finished,
                positionMs: position
            )
            await reloadCurrentDestination()

        case .endLive:
            await emit(
                "LIVE_PLAY_COMPLETE",
                playback: finished,
                positionMs: position
            )
            player?.pause()
            removeObservers()
            player?.replaceCurrentItem(with: nil)
            player = nil
            errorMessage = "This live stream has ended."
        }
    }

    private func reloadCurrentDestination() async {
        guard let player else { return }
        do {
            let refreshed = try await service.load(destination)
            let item = AVPlayerItem(url: refreshed.primaryURL)

            removeObservers()
            player.replaceCurrentItem(with: item)
            playback = refreshed
            captionTracks = refreshed.captions
            selectedCaptionId = nil
            subtitleText = ""
            cuesByTrack.removeAll()
            lastAnalyticsPositionMs = refreshed.initialOffsetMs
            lastSavedPositionMs = nil
            progressBaselineResolved = true
            playAttemptStartedAt = Date()
            startupReported = false
            installObservers(player: player, item: item)

            if refreshed.initialOffsetMs > 0 {
                await seek(player, toMilliseconds: refreshed.initialOffsetMs)
                lastAnalyticsPositionMs = refreshed.initialOffsetMs
            }

            dispatchStartAnalytics(refreshed)
            player.play()
        } catch {
            player.pause()
            removeObservers()
            player.replaceCurrentItem(with: nil)
            self.player = nil
            errorMessage = error.localizedDescription
        }
    }

    private func handleFailure(playback failed: TVPlaybackAsset, error: Error?) async {
        if let fallback = failed.mp4Fallback(), let player {
            let position = currentPositionMs() ?? 0
            removeObservers()
            let item = AVPlayerItem(url: fallback.primaryURL)
            player.replaceCurrentItem(with: item)
            playback = fallback
            installObservers(player: player, item: item)
            if position > 0 { await seek(player, toMilliseconds: position) }
            player.play()
            Task { @MainActor [weak self] in
                guard let self else { return }
                await self.emit("VIDEO_HLS_FATAL", playback: failed, positionMs: position)
                await self.emit(
                    "VIDEO_FALLBACK",
                    playback: fallback,
                    positionMs: position,
                    metadata: ["from": "HLS", "to": "MP4"]
                )
            }
            return
        }

        player?.pause()
        removeObservers()
        player?.replaceCurrentItem(with: nil)
        player = nil
        errorMessage = error?.localizedDescription ?? "Playback failed."
    }

    private func refreshSubtitle() {
        guard
            let id = selectedCaptionId,
            let cues = cuesByTrack[id],
            let position = currentPositionMs()
        else {
            subtitleText = ""
            return
        }
        subtitleText = cues.first(where: { $0.contains(position) })?.text ?? ""
    }

    private func emit(
        _ name: String,
        playback: TVPlaybackAsset,
        durationDeltaMs: Int? = nil,
        positionMs: Int? = nil,
        metadata: [String: String] = [:]
    ) async {
        var metadata = metadata
        metadata["protocol"] = playback.protocolName
        if playback.isKids { metadata["kids"] = "true" }
        await analytics.emit(
            name,
            profileId: profileId,
            videoId: playback.videoId,
            channelId: playback.channelId,
            durationDeltaMs: durationDeltaMs,
            positionMs: positionMs,
            metadata: metadata
        )
    }

    private func currentPositionMs() -> Int? {
        guard let player else { return nil }
        return positionMs(player.currentTime())
    }

    private func positionMs(_ time: CMTime) -> Int? {
        let seconds = CMTimeGetSeconds(time)
        guard seconds.isFinite, seconds >= 0 else { return nil }
        return Int(seconds * 1_000)
    }

    private func seek(_ player: AVPlayer, toMilliseconds milliseconds: Int) async {
        let target = CMTime(
            seconds: Double(max(0, milliseconds)) / 1_000,
            preferredTimescale: 600
        )
        await withCheckedContinuation { continuation in
            player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero) { _ in
                continuation.resume()
            }
        }
        lastAnalyticsPositionMs = positionMs(target)
    }
}
