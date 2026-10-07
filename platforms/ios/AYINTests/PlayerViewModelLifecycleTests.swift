import AVFoundation
import Combine
import XCTest
@testable import AYIN

@MainActor
final class PlayerViewModelLifecycleTests: XCTestCase {
    func testRetryCannotReloadOldIdentityAfterAwaitingItsFinalCheckpoint() async throws {
        let fixture = try SilentPlaybackFixture()
        defer { fixture.remove() }
        let service = LifecyclePlaybackService(playback: fixture.playback())
        let progress = DeferredLifecycleProgress()
        let model = makeModel(service: service, progress: progress)
        await load(model, token: "token-a", profile: "profile-a")

        let retry = Task { await model.retry(token: "token-a", profileId: "profile-a") }
        await fulfillment(of: [progress.saveStarted], timeout: 2)
        await load(model, token: "token-b", profile: "profile-b")
        let replacement = try XCTUnwrap(model.player)

        await progress.acknowledgeSave()
        await retry.value

        XCTAssertTrue(model.player === replacement)
        let loads = await service.loadCount
        XCTAssertEqual(loads, 2, "The old retry must not issue a third load for profile A")
        await model.stop(saveProgress: false)
    }

    func testCompletionAwaitingOldCheckpointCannotEmitForReplacementIdentity() async throws {
        let fixture = try SilentPlaybackFixture()
        defer { fixture.remove() }
        let service = LifecyclePlaybackService(playback: fixture.playback())
        let progress = DeferredLifecycleProgress()
        let completion = expectation(description: "Old completion must stay canceled")
        completion.isInverted = true
        let analytics = LifecycleAnalytics(completion: completion)
        let model = makeModel(service: service, progress: progress, analytics: analytics)
        await load(model, token: "token-a", profile: "profile-a")
        let oldItem = try XCTUnwrap(model.player?.currentItem)

        NotificationCenter.default.post(name: AVPlayerItem.didPlayToEndTimeNotification, object: oldItem)
        await fulfillment(of: [progress.saveStarted], timeout: 2)
        await load(model, token: "token-b", profile: "profile-b")
        await progress.acknowledgeSave()

        await fulfillment(of: [completion], timeout: 0.2)
        let completedProfiles = await analytics.completedProfiles
        XCTAssertTrue(completedProfiles.isEmpty)
        await model.stop(saveProgress: false)
    }

    func testQueuedFailureFromReplacedHLSItemCannotStopMP4Fallback() async throws {
        let fixture = try SilentPlaybackFixture()
        defer { fixture.remove() }
        let service = LifecyclePlaybackService(playback: fixture.playback(withFallback: true))
        let progress = DeferredLifecycleProgress()
        let model = makeModel(service: service, progress: progress)
        await load(model, token: "token-a", profile: "profile-a")
        let player = try XCTUnwrap(model.player)
        let oldItem = try XCTUnwrap(player.currentItem)
        let fallback = expectation(description: "The first failure selects the MP4 fallback")
        let unexpectedError = expectation(description: "The old item cannot fail the replacement")
        unexpectedError.isInverted = true
        let playbackObservation = model.$playback
            .compactMap { $0 }.filter { $0.protocolName == "MP4" }.first()
            .sink { _ in fallback.fulfill() }
        let errorObservation = model.$errorMessage.compactMap { $0 }
            .sink { _ in unexpectedError.fulfill() }

        // Both native notifications enqueue Tasks before either Task can run.
        NotificationCenter.default.post(name: AVPlayerItem.failedToPlayToEndTimeNotification, object: oldItem)
        NotificationCenter.default.post(name: AVPlayerItem.failedToPlayToEndTimeNotification, object: oldItem)

        await fulfillment(of: [fallback], timeout: 2)
        await fulfillment(of: [unexpectedError], timeout: 0.2)
        XCTAssertTrue(model.player === player)
        XCTAssertFalse(model.player?.currentItem === oldItem)
        XCTAssertNil(model.errorMessage)
        withExtendedLifetime([playbackObservation, errorObservation]) {}
        await model.stop(saveProgress: false)
    }


    func testViewerReplacementConcealsImmediatelyAndFencesHeldPlayback() async throws {
        let original = ViewerScope(token: "token", account: "account", profile: "profile", isKids: false)
        let replacements: [ViewerScope] = [
            .init(token: "new-token", account: "account", profile: "profile", isKids: false),
            .init(token: "token", account: "new-account", profile: "profile", isKids: false),
            .init(token: "token", account: "account", profile: "new-profile", isKids: false),
            .init(token: "token", account: "account", profile: "profile", isKids: true),
            .init(token: nil, account: nil, profile: nil, isKids: false)
        ]
        for replacementScope in replacements {
            let fixture = try SilentPlaybackFixture()
            defer { fixture.remove() }
            let service = HeldViewerPlayback(playback: fixture.playback())
            let model = makeModel(service: service, progress: DeferredLifecycleProgress())
            let originalLoad = Task {
                await model.load(token: original.token, profileId: original.profile,
                                 accountId: original.account, isKids: original.isKids)
            }
            await fulfillment(of: [service.started], timeout: 2)
            model.viewerDidChange(token: replacementScope.token, accountId: replacementScope.account,
                                  profileId: replacementScope.profile, isKids: replacementScope.isKids)
            XCTAssertNil(model.player)
            XCTAssertNil(model.playback)
            XCTAssertFalse(model.isLoading)
            await model.load(token: replacementScope.token, profileId: replacementScope.profile,
                             accountId: replacementScope.account, isKids: replacementScope.isKids)
            let replacement = try XCTUnwrap(model.player)
            replacement.pause()
            await service.release()
            await originalLoad.value
            XCTAssertTrue(model.player === replacement, "Held media must not replace the current viewer's player")
            let requests = await service.requests
            XCTAssertEqual(requests, [original, replacementScope])
            model.viewerDidChange(token: "next", accountId: "next", profileId: "next", isKids: true)
            XCTAssertNil(replacement.currentItem, "Viewer publication must synchronously stop even external playback")
            XCTAssertNil(model.player)
            XCTAssertNil(model.playback)
            XCTAssertFalse(model.progressNeedsReview)
        }
    }

    func testRestorationInvalidationDiscardsHeldMediaAndFailure() async throws {
        for reject in [false, true] {
            let fixture = try SilentPlaybackFixture()
            defer { fixture.remove() }
            let service = HeldViewerPlayback(playback: fixture.playback())
            let model = makeModel(service: service, progress: DeferredLifecycleProgress())
            let pending = Task {
                await model.load(token: "token", profileId: "profile", accountId: "account")
            }
            await fulfillment(of: [service.started], timeout: 2)
            model.invalidateViewer()
            await service.release(reject: reject)
            await pending.value
            XCTAssertNil(model.player)
            XCTAssertNil(model.playback)
            XCTAssertNil(model.errorMessage)
            XCTAssertFalse(model.isLoading)
        }
    }

    func testCanceledHeldPlaybackCannotInstallMedia() async throws {
        let fixture = try SilentPlaybackFixture()
        defer { fixture.remove() }
        let service = HeldViewerPlayback(playback: fixture.playback())
        let model = makeModel(service: service, progress: DeferredLifecycleProgress())
        let pending = Task { await model.load(token: "token", profileId: "profile", accountId: "account") }
        await fulfillment(of: [service.started], timeout: 2)
        pending.cancel()
        await service.release()
        await pending.value
        XCTAssertNil(model.player)
        XCTAssertNil(model.playback)
        XCTAssertFalse(model.isLoading)
    }

    func testDeniedViewerCannotStartMediaOrReadProgress() async throws {
        let fixture = try SilentPlaybackFixture()
        defer { fixture.remove() }
        let service = HeldViewerPlayback(playback: fixture.playback())
        let progress = DeferredLifecycleProgress()
        let model = makeModel(service: service, progress: progress)
        let pending = Task {
            await model.load(token: "token", profileId: "profile", accountId: "account", isKids: true)
        }
        await fulfillment(of: [service.started], timeout: 2)
        await service.release(reject: true)
        await pending.value
        XCTAssertNil(model.player)
        XCTAssertNil(model.playback)
        XCTAssertNotNil(model.errorMessage)
        let reads = await progress.reads
        let requests = await service.requests
        XCTAssertEqual(reads, 0)
        XCTAssertEqual(requests.count, 1)
    }

    func testWebContinuationFinishesOneCheckpointAndReleasesMediaBeforeSafari() async throws {
        let fixture = try SilentPlaybackFixture()
        defer { fixture.remove() }
        let service = LifecyclePlaybackService(playback: fixture.playback(durationMs: nil))
        let progress = DeferredLifecycleProgress()
        let model = makeModel(service: service, progress: progress)
        await load(model, token: "token-a", profile: "profile-a")
        let nativePlayer = try XCTUnwrap(model.player)
        let item = try XCTUnwrap(nativePlayer.currentItem)
        let ready = expectation(description: "Local media duration is available")
        let observation = item.publisher(for: \.status).filter { $0 == .readyToPlay }.first()
            .sink { _ in ready.fulfill() }
        await fulfillment(of: [ready], timeout: 2)
        withExtendedLifetime(observation) {}
        let shareURL = try XCTUnwrap(model.playback?.shareURL)
        let router = AppRouter()
        router.player = model.destination
        let transition = Task {
            await router.openPlaybackOnWeb(from: model.destination, shareURL: shareURL, isCurrentViewer: { true }) { await model.stop() }
        }
        await fulfillment(of: [progress.saveStarted], timeout: 2)

        XCTAssertEqual(nativePlayer.rate, 0)
        XCTAssertNil(nativePlayer.currentItem, "Held checkpoint I/O must not retain playable media")
        XCTAssertEqual(router.player, model.destination)
        XCTAssertNil(router.webFallback)
        await progress.acknowledgeSave()
        let dismissed = await transition.value
        XCTAssertTrue(dismissed)
        XCTAssertNil(nativePlayer.currentItem, "External playback must lose the old media before Safari opens")
        XCTAssertNil(model.player)
        XCTAssertNil(model.playback)
        XCTAssertNil(router.webFallback)
        let saves = await progress.saves
        let savedDurations = await progress.savedDurations
        XCTAssertEqual(saves, 1)
        XCTAssertEqual(savedDurations, [60_000], "Capture media duration before releasing the AVPlayerItem")

        router.playerDidDismiss()
        XCTAssertEqual(router.webFallback, shareURL)
        router.webFallback = nil
        XCTAssertNil(model.player, "Closing Safari must not resume the stopped native player")

        router.open(shareURL)
        await load(model, token: "token-a", profile: "profile-a")
        let loads = await service.loadCount
        XCTAssertEqual(loads, 2, "Reopening native playback must request fresh server validation")
        XCTAssertFalse(model.player === nativePlayer)
        await model.stop(saveProgress: false)
    }

    func testViewerChangeDuringWebCheckpointCannotOpenStaleSafariOrReleaseReplacementMedia() async throws {
        let fixture = try SilentPlaybackFixture()
        defer { fixture.remove() }
        let service = LifecyclePlaybackService(playback: fixture.playback())
        let progress = DeferredLifecycleProgress()
        let model = makeModel(service: service, progress: progress)
        await load(model, token: "token-a", profile: "profile-a")
        let nativePlayer = try XCTUnwrap(model.player)
        let shareURL = try XCTUnwrap(model.playback?.shareURL)
        let router = AppRouter()
        router.player = model.destination
        let transition = Task {
            await router.openPlaybackOnWeb(from: model.destination, shareURL: shareURL, isCurrentViewer: { true }) { await model.stop() }
        }
        await fulfillment(of: [progress.saveStarted], timeout: 2)

        router.cancelPlaybackWebContinuation()
        model.viewerDidChange(token: "token-b", accountId: nil, profileId: "profile-b", isKids: false)
        XCTAssertNil(nativePlayer.currentItem)
        await load(model, token: "token-b", profile: "profile-b")
        let replacement = try XCTUnwrap(model.player)
        await progress.acknowledgeSave()
        let dismissed = await transition.value

        XCTAssertFalse(dismissed)
        XCTAssertTrue(model.player === replacement)
        XCTAssertEqual(router.player, model.destination)
        XCTAssertNil(router.webFallback)
        let loads = await service.loadCount
        XCTAssertEqual(loads, 2)
        await model.stop(saveProgress: false)
    }

    func testCanceledWebContinuationStillReleasesNativeMediaAfterHeldCheckpoint() async throws {
        let fixture = try SilentPlaybackFixture()
        defer { fixture.remove() }
        let service = LifecyclePlaybackService(playback: fixture.playback())
        let progress = DeferredLifecycleProgress()
        let model = makeModel(service: service, progress: progress)
        await load(model, token: "token-a", profile: "profile-a")
        let nativePlayer = try XCTUnwrap(model.player)
        let shareURL = try XCTUnwrap(model.playback?.shareURL)
        let router = AppRouter()
        router.player = model.destination
        let transition = Task {
            await router.openPlaybackOnWeb(from: model.destination, shareURL: shareURL, isCurrentViewer: { true }) { await model.stop() }
        }
        await fulfillment(of: [progress.saveStarted], timeout: 2)
        transition.cancel()
        router.closePlayer()
        router.playerDidDismiss()
        await progress.acknowledgeSave()
        let dismissed = await transition.value

        XCTAssertFalse(dismissed)
        XCTAssertNil(nativePlayer.currentItem)
        XCTAssertNil(model.player)
        XCTAssertNil(model.playback)
        XCTAssertNil(router.player)
        XCTAssertNil(router.webFallback)
        let saves = await progress.saves
        XCTAssertEqual(saves, 1)
    }

    func testHeldResumeCannotSeekMediaReopenedAfterWebContinuation() async throws {
        let fixture = try SilentPlaybackFixture()
        defer { fixture.remove() }
        let service = LifecyclePlaybackService(playback: fixture.playback())
        let progress = HeldResumeLifecycleProgress()
        let model = makeModel(service: service, progress: progress)
        await model.load(token: "token-a", profileId: "profile-a")
        model.player?.pause()
        await fulfillment(of: [progress.readStarted], timeout: 2)
        let nativePlayer = try XCTUnwrap(model.player)
        let shareURL = try XCTUnwrap(model.playback?.shareURL)
        let router = AppRouter()
        router.player = model.destination

        let dismissed = await router.openPlaybackOnWeb(from: model.destination, shareURL: shareURL, isCurrentViewer: { true }) { await model.stop() }
        XCTAssertTrue(dismissed, "An unresolved resume lookup must not block Web continuation")
        XCTAssertNil(nativePlayer.currentItem)
        router.playerDidDismiss()
        router.webFallback = nil
        router.open(shareURL)
        await load(model, token: "token-a", profile: "profile-a")
        let replacement = try XCTUnwrap(model.player)
        let replacementItem = try XCTUnwrap(replacement.currentItem)
        XCTAssertLessThan(CMTimeGetSeconds(replacement.currentTime()), 2.5)
        let unexpectedSeek = expectation(description: "Held 40-second resume must not move the reopened player")
        unexpectedSeek.isInverted = true
        let observer = NotificationCenter.default.addObserver(
            forName: AVPlayerItem.timeJumpedNotification, object: replacementItem, queue: .main
        ) { notification in
            // A notification alone does not identify a resume seek. Inspect its
            // position so events near the current zero baseline are not mistaken
            // for the held response's 40-second position.
            guard let item = notification.object as? AVPlayerItem else { return }
            let position = CMTimeGetSeconds(item.currentTime())
            if position.isFinite, position >= 2.5 { unexpectedSeek.fulfill() }
        }
        defer { NotificationCenter.default.removeObserver(observer) }
        await progress.releaseRead()
        await fulfillment(of: [progress.readReturned], timeout: 2)
        await fulfillment(of: [unexpectedSeek], timeout: 0.2)

        XCTAssertTrue(model.player === replacement)
        XCTAssertTrue(replacement.currentItem === replacementItem)
        XCTAssertLessThan(CMTimeGetSeconds(replacement.currentTime()), 2.5)
        XCTAssertNil(nativePlayer.currentItem)
        let loads = await service.loadCount
        let saves = await progress.saves
        let heldReadWasCancelled = await progress.heldReadWasCancelled
        XCTAssertEqual(loads, 2)
        XCTAssertEqual(saves, 0, "Unknown progress must not be overwritten during the transition")
        XCTAssertEqual(heldReadWasCancelled, true, "Stop must cancel the held lookup even when its transport still returns")
        await model.stop(saveProgress: false)
    }

    private func makeModel(
        service: any PlaybackServicing,
        progress: any WatchProgressServicing,
        analytics: LifecycleAnalytics = LifecycleAnalytics()
    ) -> PlayerViewModel {
        PlayerViewModel(
            destination: PlayerDestination(kind: .video, slug: "lifecycle-test", isKids: false),
            service: service,
            progressService: progress,
            analytics: analytics
        )
    }

    private func load(_ model: PlayerViewModel, token: String, profile: String) async {
        await model.load(token: token, profileId: profile)
        model.player?.pause()
        XCTAssertNotNil(model.player)
        XCTAssertNil(model.errorMessage)
        let ready = expectation(description: "Progress baseline is resolved")
        let observation = model.$isReviewingProgress.filter { !$0 }.first()
            .sink { _ in ready.fulfill() }
        await fulfillment(of: [ready], timeout: 2)
        withExtendedLifetime(observation) {}
    }
}


private struct ViewerScope: Equatable {
    let token: String?
    let account: String?
    let profile: String?
    let isKids: Bool
}

private actor HeldViewerPlayback: PlaybackServicing {
    nonisolated let started = XCTestExpectation(description: "Playback response is held")
    private let playback: NativePlayback
    private(set) var requests: [ViewerScope] = []
    private var continuation: CheckedContinuation<NativePlayback, Error>?

    init(playback: NativePlayback) { self.playback = playback }

    func load(_ destination: PlayerDestination, token: String?, accountId: String?,
              profileId: String?, isKids: Bool) async throws -> NativePlayback {
        requests.append(.init(token: token, account: accountId, profile: profileId, isKids: isKids))
        guard requests.count == 1 else { return playback }
        // Ignore cancellation deliberately: transports may deliver an already-completed response late.
        return try await withCheckedThrowingContinuation {
            continuation = $0
            started.fulfill()
        }
    }

    func release(reject: Bool = false) {
        guard let continuation else { return }
        self.continuation = nil
        if reject { continuation.resume(throwing: APIClientError.server(status: 409, message: "Viewer changed")) }
        else { continuation.resume(returning: playback) }
    }
}

private actor LifecyclePlaybackService: PlaybackServicing {
    let playback: NativePlayback
    private(set) var loadCount = 0

    init(playback: NativePlayback) { self.playback = playback }

    func load(_ destination: PlayerDestination, token: String?, accountId: String?,
              profileId: String?, isKids: Bool) async throws -> NativePlayback {
        loadCount += 1
        return playback
    }
}

private actor DeferredLifecycleProgress: WatchProgressServicing {
    nonisolated let saveStarted = XCTestExpectation(description: "Old checkpoint is awaiting acknowledgment")
    private var continuation: CheckedContinuation<WatchProgress, Error>?
    private var acknowledgment: WatchProgress?
    private(set) var reads = 0
    private(set) var saves = 0
    private(set) var savedDurations: [Int?] = []

    func progress(videoId: String, profileId: String?, token: String) async throws -> WatchProgress {
        reads += 1
        return WatchProgress(profileId: profileId ?? "", videoId: videoId, positionMs: 0,
                      completedAt: nil, revision: "2026-10-06T08:00:00.001Z")
    }

    func save(
        videoId: String, profileId: String?, positionMs: Int,
        durationMs: Int?, expectedRevision: String?, token: String
    ) async throws -> WatchProgress {
        saves += 1
        savedDurations.append(durationMs)
        acknowledgment = WatchProgress(profileId: profileId ?? "", videoId: videoId, positionMs: positionMs,
                                       completedAt: nil, revision: "2026-10-06T08:00:00.002Z")
        // Deliberately ignore cancellation so the test exercises a late transport result.
        return try await withCheckedThrowingContinuation {
            continuation = $0
            saveStarted.fulfill()
        }
    }

    func acknowledgeSave() {
        guard let continuation, let acknowledgment else { return }
        self.continuation = nil
        self.acknowledgment = nil
        continuation.resume(returning: acknowledgment)
    }
}

private actor HeldResumeLifecycleProgress: WatchProgressServicing {
    nonisolated let readStarted = XCTestExpectation(description: "Old resume response is held")
    nonisolated let readReturned = XCTestExpectation(description: "Held resume response was delivered")
    private var continuation: CheckedContinuation<WatchProgress, Never>?
    private var heldProgress: WatchProgress?
    private(set) var reads = 0
    private(set) var saves = 0
    private(set) var heldReadWasCancelled: Bool?

    func progress(videoId: String, profileId: String?, token: String) async throws -> WatchProgress {
        reads += 1
        guard reads == 1 else {
            return WatchProgress(profileId: profileId ?? "", videoId: videoId, positionMs: 0,
                                 completedAt: nil, revision: "2026-10-06T08:00:00.002Z")
        }
        heldProgress = WatchProgress(profileId: profileId ?? "", videoId: videoId, positionMs: 40_000,
                                     completedAt: nil, revision: "2026-10-06T08:00:00.001Z")
        // A transport may ignore cancellation and return after Safari or a new player opens.
        let response: WatchProgress = await withCheckedContinuation {
            continuation = $0
            readStarted.fulfill()
        }
        heldReadWasCancelled = Task.isCancelled
        readReturned.fulfill()
        return response
    }

    func releaseRead() {
        guard let continuation, let heldProgress else { return }
        self.continuation = nil
        self.heldProgress = nil
        continuation.resume(returning: heldProgress)
    }

    func save(videoId: String, profileId: String?, positionMs: Int, durationMs: Int?,
              expectedRevision: String?, token: String) async throws -> WatchProgress {
        saves += 1
        return WatchProgress(profileId: profileId ?? "", videoId: videoId, positionMs: positionMs,
                             completedAt: nil, revision: "2026-10-06T08:00:00.003Z")
    }
}

private actor LifecycleAnalytics: AnalyticsTracking {
    let completion: XCTestExpectation?
    private(set) var completedProfiles: [String?] = []

    init(completion: XCTestExpectation? = nil) { self.completion = completion }

    func emit(
        _ eventName: String, profileId: String?, videoId: String?, channelId: String?,
        durationDeltaMs: Int?, positionMs: Int?, metadata: [String: String]
    ) async {
        if eventName == "VIDEO_COMPLETE" {
            completedProfiles.append(profileId)
            completion?.fulfill()
        }
    }
}

/// Local silent audio keeps AVPlayer tests independent of network and production media.
private struct SilentPlaybackFixture {
    let url: URL

    init() throws {
        url = FileManager.default.temporaryDirectory.appendingPathComponent("ayin-\(UUID().uuidString).wav")
        let byteCount: UInt32 = 8_000 * 2 * 60
        var data = Data("RIFF".utf8)
        func append<T: FixedWidthInteger>(_ value: T) {
            var littleEndian = value.littleEndian
            withUnsafeBytes(of: &littleEndian) { data.append(contentsOf: $0) }
        }
        append(byteCount + 36)
        data.append(Data("WAVEfmt ".utf8))
        append(UInt32(16))
        append(UInt16(1))
        append(UInt16(1))
        append(UInt32(8_000))
        append(UInt32(16_000))
        append(UInt16(2))
        append(UInt16(16))
        data.append(Data("data".utf8))
        append(byteCount)
        data.append(Data(count: Int(byteCount)))
        try data.write(to: url)
    }

    func playback(withFallback: Bool = false, durationMs: Int? = 60_000) -> NativePlayback {
        NativePlayback(title: "Lifecycle fixture", sourceURL: url,
                       fallbackSourceURL: withFallback ? url : nil,
                       shareURL: URL(string: "https://ayin.stream/watch/lifecycle-test")!,
                       isLive: false, isKids: false, videoId: "video", channelId: "channel",
                       durationMs: durationMs, protocolName: withFallback ? "HLS" : "MP4")
    }

    func remove() { try? FileManager.default.removeItem(at: url) }
}
