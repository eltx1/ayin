import AVFoundation
import Combine
import Foundation

struct TVPlaybackControlContext: Equatable {
    let generation: UInt64
    let item: ObjectIdentifier
}

@MainActor
final class TVPlayerViewModel: ObservableObject {
    @Published private(set) var player: AVPlayer?
    @Published private(set) var playback: TVPlaybackAsset?
    @Published private(set) var captionTracks: [TVCaptionTrack] = []
    @Published private(set) var selectedCaptionId: String?
    @Published private(set) var subtitleText = ""
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?
    @Published private(set) var progressNeedsReview = false
    @Published private(set) var isReviewingProgress = false

    @Published private(set) var destination: TVPlaybackDestination

    var controlContext: TVPlaybackControlContext? {
        guard let item = player?.currentItem else { return nil }
        return TVPlaybackControlContext(generation: loadGeneration, item: ObjectIdentifier(item))
    }

    private let service: any TVPlaybackServicing
    private let progress: any WatchProgressServicing
    private let analytics: any TVAnalyticsTracking
    private let session: URLSession

    private var token: String?
    private var accountId: String?
    private var profileId: String?
    private var viewerIsKids = false
    private var periodicObserver: Any?
    private var subtitleObserver: Any?
    private var notificationObservers: [NSObjectProtocol] = []
    private var timeControlObservation: NSKeyValueObservation?
    private var resumeTask: Task<Void, Never>?
    private var startupTask: Task<Void, Never>?
    private var checkpointTask: Task<Void, Never>?
    private var checkpointWorkerID: UUID?
    private var pendingCheckpoint: PlaybackCheckpoint?
    private var pendingNavigationSequence: UInt64 = 0
    private var cuesByTrack: [String: [TVCaptionCue]] = [:]
    private var lastAnalyticsPositionMs: Int?
    private var progressState = ProgressRevisionState()
    private var loadGeneration: UInt64 = 0
    private var navigationSequence: UInt64 = 0
    private var savedNavigationSequence: UInt64 = 0
    private var didComplete = false
    private var playAttemptStartedAt: Date?
    private var startupReported = false
    private var sceneResumeState = TVSceneResumeState()
    private var sceneIsActive = true
    private var pictureInPictureActive = false
    private var userNavigatedDuringStartup = false
    private var episodeTransitionID: UUID?

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

    func load(token: String?, profileId: String?, accountId: String? = nil, isKids: Bool = false) async {
        guard !Task.isCancelled else { return }
        viewerDidChange(token: token, accountId: accountId, profileId: profileId, isKids: isKids)
        guard player == nil, !isLoading else { return }
        loadGeneration &+= 1
        let generation = loadGeneration
        isLoading = true
        errorMessage = nil
        self.token = token
        self.accountId = accountId
        self.profileId = profileId
        viewerIsKids = isKids
        userNavigatedDuringStartup = false
        defer { if loadGeneration == generation { isLoading = false } }

        do {
            let playback = try await service.load(destination, token: token, accountId: accountId,
                                                  profileId: profileId, isKids: isKids)
            try Task.checkCancellation()
            guard loadGeneration == generation else { return }

            let item = AVPlayerItem(url: playback.primaryURL)
            let player = AVPlayer(playerItem: item)
            player.automaticallyWaitsToMinimizeStalling = true

            self.playback = playback
            self.player = player
            captionTracks = playback.captions
            lastAnalyticsPositionMs = playback.initialOffsetMs
            progressState.reset()
            progressNeedsReview = false
            installObservers(player: player, item: item)

            if playback.initialOffsetMs > 0 {
                await seek(player, toMilliseconds: playback.initialOffsetMs)
            }
            guard !Task.isCancelled, ownsPlayback(player, item: item, generation: generation) else { return }

            dispatchStartAnalytics(playback)
            playAttemptStartedAt = Date()
            player.play()
            handleScene(active: sceneIsActive)

            if let defaultTrack = playback.captions.first(where: { $0.isDefault }) {
                Task { @MainActor [weak self, weak player, weak item] in
                    guard let self, self.ownsPlayback(player, item: item, generation: generation) else { return }
                    await self.selectCaption(defaultTrack.id)
                }
            }

            loadResumePosition(player: player, playback: playback)
        } catch is CancellationError {
            return
        } catch {
            guard loadGeneration == generation else { return }
            errorMessage = error.localizedDescription
        }
    }

    func retry(token: String?, profileId: String?, accountId: String? = nil, isKids: Bool = false) async {
        guard await stop(), !Task.isCancelled else { return }
        await load(token: token, profileId: profileId, accountId: accountId, isKids: isKids)
    }

    func viewerDidChange(token: String?, accountId: String?, profileId: String?, isKids: Bool) {
        guard self.token != token || self.accountId != accountId || self.profileId != profileId ||
                viewerIsKids != isKids else { return }
        invalidateViewer()
    }

    // Invalidate both visible media and any held transport result in the same actor turn.
    func invalidateViewer() {
        loadGeneration &+= 1
        episodeTransitionID = nil
        isLoading = false
        player?.pause()
        removeObservers()
        resumeTask?.cancel()
        resumeTask = nil
        startupTask?.cancel()
        startupTask = nil
        checkpointTask?.cancel()
        clearPlayback()
        errorMessage = nil
    }

    func selectCaption(_ id: String?) async {
        let generation = loadGeneration
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
                    !Task.isCancelled, loadGeneration == generation, selectedCaptionId == id,
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

    func selectCaption(_ id: String?, context: TVPlaybackControlContext) async {
        guard controlContext == context else { return }
        await selectCaption(id)
    }

    func seekChapter(_ id: String, context: TVPlaybackControlContext) async {
        guard controlContext == context, episodeTransitionID == nil,
              let player, let playback, !playback.isLive,
              let chapter = playback.chapters.first(where: { $0.id == id }) else { return }
        let target = CMTime(value: Int64(chapter.startMs), timescale: 1_000)
        // Mark navigation before suspending so a held saved-position read cannot undo it.
        noteUserNavigation(to: target)
        await seek(player, toMilliseconds: chapter.startMs)
        guard controlContext == context else { return }
        refreshSubtitle()
    }

    func playNextEpisode(context: TVPlaybackControlContext) async {
        guard controlContext == context, episodeTransitionID == nil,
              let next = playback?.nextEpisodeDestination else { return }
        let transitionID = UUID()
        episodeTransitionID = transitionID
        defer { if episodeTransitionID == transitionID { episodeTransitionID = nil } }
        let token = self.token
        let accountId = self.accountId
        let profileId = self.profileId
        let isKids = viewerIsKids

        // Finish the current checkpoint before requesting fresh playback authorization.
        guard await stop(), !Task.isCancelled else { return }
        destination = next
        await load(token: token, profileId: profileId, accountId: accountId, isKids: isKids)
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
        guard episodeTransitionID == nil else { return }
        userNavigatedDuringStartup = true
        lastAnalyticsPositionMs = positionMs(time)
        if progressState.snapshot != nil, !progressState.requiresReview, !isReviewingProgress {
            navigationSequence &+= 1
            _ = enqueueCheckpoint(time, forceProgressSave: true)
        }
    }

    func noteUserNavigation(to time: CMTime, context: TVPlaybackControlContext) {
        guard controlContext == context else { return }
        noteUserNavigation(to: time)
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

    @discardableResult
    func stop(saveProgress: Bool = true) async -> Bool {
        loadGeneration &+= 1
        let generation = loadGeneration
        isLoading = true
        resumeTask?.cancel()
        resumeTask = nil
        startupTask?.cancel()
        startupTask = nil

        player?.pause()
        removeObservers()
        if saveProgress, let player {
            _ = enqueueCheckpoint(player.currentTime(), forceProgressSave: true)
        }
        // Detach media before checkpoint I/O: AVKit may still issue Play while it settles.
        player?.replaceCurrentItem(with: nil)
        player = nil
        if !saveProgress {
            checkpointTask?.cancel()
            checkpointWorkerID = nil
            progressState.reset()
        } else if let checkpointTask {
            await checkpointTask.value
        }
        guard loadGeneration == generation else { return false }

        clearPlayback()
        isLoading = false
        return true
    }

    private func clearPlayback() {
        checkpointTask = nil
        checkpointWorkerID = nil
        pendingCheckpoint = nil
        player?.replaceCurrentItem(with: nil)
        player = nil
        playback = nil
        captionTracks = []
        selectedCaptionId = nil
        subtitleText = ""
        cuesByTrack.removeAll()
        token = nil
        accountId = nil
        profileId = nil
        viewerIsKids = false
        lastAnalyticsPositionMs = nil
        progressState.reset()
        progressNeedsReview = false
        isReviewingProgress = false
        navigationSequence = 0
        savedNavigationSequence = 0
        pendingNavigationSequence = 0
        didComplete = false
        playAttemptStartedAt = nil
        startupReported = false
        sceneResumeState.reset()
        pictureInPictureActive = false
        userNavigatedDuringStartup = false
    }

    private func installObservers(player: AVPlayer, item: AVPlayerItem) {
        removeObservers()
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

        subtitleObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.25, preferredTimescale: 600),
            queue: .main
        ) { [weak self, weak player, weak item] _ in
            Task { @MainActor [weak self, weak player, weak item] in
                guard let self, self.ownsPlayback(player, item: item, generation: generation) else { return }
                self.refreshSubtitle()
            }
        }

        timeControlObservation = player.observe(\.timeControlStatus, options: [.new]) {
            [weak self, weak item] observed, _ in
            Task { @MainActor [weak self, weak item] in
                guard let self, self.ownsPlayback(observed, item: item, generation: generation),
                      observed.timeControlStatus == .playing else { return }
                self.reportStartupIfNeeded()
            }
        }

        let center = NotificationCenter.default
        notificationObservers.append(
            center.addObserver(
                forName: AVPlayerItem.failedToPlayToEndTimeNotification,
                object: item,
                queue: .main
            ) { [weak self, weak player, weak item] note in
                Task { @MainActor [weak self, weak player, weak item] in
                    guard let self, self.ownsPlayback(player, item: item, generation: generation),
                          let playback = self.playback else { return }
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
            ) { [weak self, weak player, weak item] _ in
                Task { @MainActor [weak self, weak player, weak item] in
                    guard let self, self.ownsPlayback(player, item: item, generation: generation),
                          !self.didComplete, let playback = self.playback else { return }
                    self.didComplete = true
                    await self.handleSuccessfulCompletion(playback: playback)
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
                    self.lastAnalyticsPositionMs = self.currentPositionMs()
                }
            }
        )
    }

    private func ownsPlayback(_ player: AVPlayer?, item: AVPlayerItem?, generation: UInt64) -> Bool {
        guard let player, let item else { return false }
        return loadGeneration == generation && self.player === player && player.currentItem === item
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
        let generation = loadGeneration
        Task { @MainActor [weak self] in
            guard let self, self.loadGeneration == generation else { return }
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
        let generation = loadGeneration
        let ms = max(0, min(3_600_000, Int(Date().timeIntervalSince(started) * 1_000)))
        startupTask?.cancel()
        startupTask = Task { @MainActor [weak self] in
            guard let self, !Task.isCancelled, self.loadGeneration == generation else { return }
            await self.emit(
                playback.isLive ? "LIVE_STARTUP" : "VIDEO_STARTUP",
                playback: playback,
                durationDeltaMs: ms
            )
        }
    }

    private func loadResumePosition(player: AVPlayer, playback: TVPlaybackAsset, allowResume: Bool = true) {
        guard
            !playback.isLive,
            let token,
            let videoId = playback.videoId
        else { return }

        resumeTask?.cancel()
        let profileId = self.profileId
        let generation = loadGeneration
        let ticket = progressState.beginRead()
        savedNavigationSequence = navigationSequence
        isReviewingProgress = true
        resumeTask = Task { @MainActor [weak self, weak player] in
            guard let self, let player else { return }
            do {
                let state = try await self.progress.progress(
                    videoId: videoId,
                    profileId: profileId,
                    token: token
                )
                guard !Task.isCancelled, self.player === player, self.loadGeneration == generation,
                      self.progressState.accept(state, for: ticket) else { return }
                self.progressNeedsReview = false
                self.isReviewingProgress = false

                if allowResume, TVResumePolicy.shouldApplySavedPosition(
                    positionMs: state.positionMs,
                    completedAt: state.completedAt,
                    userNavigated: self.userNavigatedDuringStartup
                ) {
                    await self.seek(player, toMilliseconds: state.positionMs)
                    guard !Task.isCancelled, self.player === player, self.loadGeneration == generation else { return }
                    self.lastAnalyticsPositionMs = state.positionMs
                }
            } catch {
                guard !Task.isCancelled, self.player === player, self.loadGeneration == generation,
                      self.progressState.fail(ticket) else { return }
                self.savedNavigationSequence = self.navigationSequence
                self.pendingCheckpoint = nil
                self.progressNeedsReview = true
                self.isReviewingProgress = false
            }
        }
    }

    func reviewProgress() {
        guard !isReviewingProgress, let player, let playback else { return }
        pendingCheckpoint = nil
        loadResumePosition(player: player, playback: playback, allowResume: false)
    }

    @discardableResult
    private func enqueueCheckpoint(
        _ time: CMTime,
        forceProgressSave: Bool = false
    ) -> Task<Void, Never>? {
        guard let position = positionMs(time) else { return nil }
        // A queued timer tick cannot replace a user's explicit seek/exit checkpoint.
        if pendingCheckpoint?.forceProgressSave == true, !forceProgressSave {
            return checkpointTask
        }
        pendingCheckpoint = PlaybackAccounting.coalescedCheckpoint(
            existing: pendingCheckpoint,
            positionMs: position,
            forceProgressSave: forceProgressSave
        )
        pendingNavigationSequence = navigationSequence
        if let checkpointTask { return checkpointTask }

        let workerID = UUID()
        checkpointWorkerID = workerID
        let worker = Task { @MainActor [weak self] in
            guard let self else { return }
            while let checkpoint = self.pendingCheckpoint, !Task.isCancelled,
                  self.checkpointWorkerID == workerID {
                self.pendingCheckpoint = nil
                let navigation = self.pendingNavigationSequence
                await self.performCheckpoint(checkpoint, navigation: navigation)
            }
            if self.checkpointWorkerID == workerID {
                self.checkpointTask = nil
                self.checkpointWorkerID = nil
            }
        }
        checkpointTask = worker
        return worker
    }

    private func performCheckpoint(_ checkpoint: PlaybackCheckpoint, navigation: UInt64) async {
        guard let playback else { return }
        let generation = loadGeneration
        let watched = PlaybackAccounting.watchedDeltaMs(
            previousPositionMs: lastAnalyticsPositionMs,
            currentPositionMs: checkpoint.positionMs
        )
        lastAnalyticsPositionMs = checkpoint.positionMs

        if watched > 0 {
            Task { @MainActor [weak self] in
                guard let self, self.loadGeneration == generation else { return }
                await self.emit(
                    playback.isLive ? "LIVE_DURATION" : "VIDEO_PROGRESS",
                    playback: playback,
                    durationDeltaMs: watched,
                    positionMs: checkpoint.positionMs
                )
            }
        }

        guard
            !playback.isLive, !Task.isCancelled,
            let baseline = progressState.snapshot,
            let token,
            let videoId = playback.videoId
        else { return }

        guard TVProgressPersistence.shouldSave(
            lastSavedPositionMs: baseline.positionMs,
            currentPositionMs: checkpoint.positionMs,
            force: checkpoint.forceProgressSave
        ) else { return }
        guard let ticket = progressState.beginSave(
            positionMs: checkpoint.positionMs,
            allowsBackward: navigation > savedNavigationSequence
        ) else { return }

        do {
            let saved = try await progress.save(
                videoId: videoId,
                profileId: profileId,
                positionMs: checkpoint.positionMs,
                durationMs: playback.durationMs,
                expectedRevision: ticket.expectedRevision,
                token: token
            )
            guard !Task.isCancelled, progressState.accept(saved, for: ticket) else { return }
            savedNavigationSequence = navigation
            progressNeedsReview = false
        } catch {
            guard !Task.isCancelled, progressState.fail(ticket) else { return }
            // A conflict or unknown acknowledgment never authorizes an automatic replay.
            savedNavigationSequence = navigationSequence
            pendingCheckpoint = nil
            progressNeedsReview = true
        }
    }

    private func handleSuccessfulCompletion(playback finished: TVPlaybackAsset) async {
        guard let player, let item = player.currentItem else { return }
        let generation = loadGeneration
        let position = currentPositionMs() ?? finished.durationMs ?? 0

        switch TVPlaybackLifecycle.completionAction(for: destination) {
        case .finalizeVOD:
            let finalCheckpoint = enqueueCheckpoint(
                player.currentTime(),
                forceProgressSave: true
            )
            await finalCheckpoint?.value
            guard ownsPlayback(player, item: item, generation: generation) else { return }
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
            guard ownsPlayback(player, item: item, generation: generation) else { return }
            await reloadCurrentDestination()

        case .endLive:
            await emit(
                "LIVE_PLAY_COMPLETE",
                playback: finished,
                positionMs: position
            )
            guard ownsPlayback(player, item: item, generation: generation) else { return }
            player.pause()
            removeObservers()
            player.replaceCurrentItem(with: nil)
            self.player = nil
            errorMessage = TVStrings.text("This live stream has ended.")
        }
    }

    private func reloadCurrentDestination() async {
        guard let player, let oldItem = player.currentItem else { return }
        let generation = loadGeneration
        do {
            let refreshed = try await service.load(destination, token: token, accountId: accountId,
                                                   profileId: profileId, isKids: viewerIsKids)
            guard !Task.isCancelled, ownsPlayback(player, item: oldItem, generation: generation) else { return }
            let item = AVPlayerItem(url: refreshed.primaryURL)

            removeObservers()
            player.replaceCurrentItem(with: item)
            playback = refreshed
            captionTracks = refreshed.captions
            selectedCaptionId = nil
            subtitleText = ""
            cuesByTrack.removeAll()
            lastAnalyticsPositionMs = refreshed.initialOffsetMs
            progressState.reset()
            progressNeedsReview = false
            isReviewingProgress = false
            navigationSequence = 0
            savedNavigationSequence = 0
            pendingNavigationSequence = 0
            didComplete = false
            playAttemptStartedAt = Date()
            startupReported = false
            installObservers(player: player, item: item)

            if refreshed.initialOffsetMs > 0 {
                await seek(player, toMilliseconds: refreshed.initialOffsetMs)
                guard ownsPlayback(player, item: item, generation: generation) else { return }
                lastAnalyticsPositionMs = refreshed.initialOffsetMs
            }

            dispatchStartAnalytics(refreshed)
            player.play()
        } catch {
            guard ownsPlayback(player, item: oldItem, generation: generation) else { return }
            player.pause()
            removeObservers()
            player.replaceCurrentItem(with: nil)
            self.player = nil
            errorMessage = error.localizedDescription
        }
    }

    private func handleFailure(playback failed: TVPlaybackAsset, error: Error?) async {
        let generation = loadGeneration
        if let fallback = failed.mp4Fallback(), let player {
            let position = currentPositionMs() ?? 0
            removeObservers()
            let item = AVPlayerItem(url: fallback.primaryURL)
            player.replaceCurrentItem(with: item)
            playback = fallback
            installObservers(player: player, item: item)
            if position > 0 { await seek(player, toMilliseconds: position) }
            guard ownsPlayback(player, item: item, generation: generation) else { return }
            lastAnalyticsPositionMs = position
            player.play()
            Task { @MainActor [weak self, weak player, weak item] in
                guard let self, self.ownsPlayback(player, item: item, generation: generation) else { return }
                await self.emit("VIDEO_HLS_FATAL", playback: failed, positionMs: position)
                guard self.ownsPlayback(player, item: item, generation: generation) else { return }
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
        errorMessage = error?.localizedDescription ?? TVStrings.text("Playback failed.")
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
    }
}
