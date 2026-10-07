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

    private func makeModel(
        service: any PlaybackServicing,
        progress: DeferredLifecycleProgress,
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

    func progress(videoId: String, profileId: String?, token: String) async throws -> WatchProgress {
        reads += 1
        return WatchProgress(profileId: profileId ?? "", videoId: videoId, positionMs: 0,
                      completedAt: nil, revision: "2026-10-06T08:00:00.001Z")
    }

    func save(
        videoId: String, profileId: String?, positionMs: Int,
        durationMs: Int?, expectedRevision: String?, token: String
    ) async throws -> WatchProgress {
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

    func playback(withFallback: Bool = false) -> NativePlayback {
        NativePlayback(title: "Lifecycle fixture", sourceURL: url,
                       fallbackSourceURL: withFallback ? url : nil,
                       shareURL: URL(string: "https://ayin.stream/watch/lifecycle-test")!,
                       isLive: false, isKids: false, videoId: "video", channelId: "channel",
                       durationMs: 60_000, protocolName: withFallback ? "HLS" : "MP4")
    }

    func remove() { try? FileManager.default.removeItem(at: url) }
}
