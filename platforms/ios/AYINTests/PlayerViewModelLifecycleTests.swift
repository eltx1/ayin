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

    private func makeModel(
        service: LifecyclePlaybackService,
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

private actor LifecyclePlaybackService: PlaybackServicing {
    let playback: NativePlayback
    private(set) var loadCount = 0

    init(playback: NativePlayback) { self.playback = playback }

    func load(_ destination: PlayerDestination) async throws -> NativePlayback {
        loadCount += 1
        return playback
    }
}

private actor DeferredLifecycleProgress: WatchProgressServicing {
    nonisolated let saveStarted = XCTestExpectation(description: "Old checkpoint is awaiting acknowledgment")
    private var continuation: CheckedContinuation<WatchProgress, Error>?
    private var acknowledgment: WatchProgress?

    func progress(videoId: String, profileId: String?, token: String) async throws -> WatchProgress {
        WatchProgress(profileId: profileId ?? "", videoId: videoId, positionMs: 0,
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
