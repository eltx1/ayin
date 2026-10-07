import AVFoundation
import Combine
import XCTest
@testable import AYINTV

@MainActor
final class TVProgressContractTests: XCTestCase {
    func testExplicitBackwardSeeksSerializeAndUseAcknowledgedRevision() async throws {
        let fixture = try TVSilentProgressFixture()
        defer { fixture.remove() }
        let progress = TVProgressProbe()
        let model = makeModel(fixture, progress: progress)
        await load(model, profile: "a")

        model.noteUserNavigation(to: milliseconds(40_000))
        await fulfillment(of: [progress.firstSave], timeout: 2)
        model.noteUserNavigation(to: milliseconds(30_000))
        let pending = await progress.writes
        XCTAssertEqual(pending.count, 1)
        await progress.resolveFirstSave()
        await fulfillment(of: [progress.secondSave], timeout: 2)

        let writes = await progress.writes
        XCTAssertEqual(writes.map(\.position), [40_000, 30_000])
        XCTAssertEqual(writes.map(\.revision), [TVProgressProbe.firstRevision, TVProgressProbe.ackRevision])
        await model.stop(saveProgress: false)
    }

    func testConflictAndUnknownAcknowledgmentDiscardQueuedSeekUntilReadReview() async throws {
        for error in [APIClientError.server(status: 409, message: "Conflict") as Error,
                      URLError(.networkConnectionLost) as Error] {
            let fixture = try TVSilentProgressFixture()
            defer { fixture.remove() }
            let progress = TVProgressProbe()
            let model = makeModel(fixture, progress: progress)
            await load(model, profile: "a")
            model.noteUserNavigation(to: milliseconds(40_000))
            await fulfillment(of: [progress.firstSave], timeout: 2)
            model.noteUserNavigation(to: milliseconds(20_000))
            await progress.resolveFirstSave(error: error)
            await waitForReview(model)

            model.reviewProgress()
            await waitForRead(model)
            XCTAssertFalse(model.progressNeedsReview)
            let unexpected = expectation(description: "Review must not replay the queued seek")
            unexpected.isInverted = true
            await progress.rejectUnexpectedWrites(using: unexpected)
            model.handleScene(active: false)
            await fulfillment(of: [unexpected], timeout: 0.2)
            await progress.rejectUnexpectedWrites(using: nil)
            let afterReview = await progress.writes
            let reads = await progress.reads
            XCTAssertEqual(afterReview.count, 1)
            XCTAssertEqual(reads, 2, "Only the initial baseline and explicit review may read")

            model.noteUserNavigation(to: milliseconds(30_000))
            await fulfillment(of: [progress.secondSave], timeout: 2)
            let refreshed = await progress.writes
            XCTAssertEqual(refreshed.last?.revision, TVProgressProbe.reviewRevision)
            XCTAssertEqual(refreshed.last?.position, 30_000)
            await model.stop(saveProgress: false)
        }
    }

    func testLateAcknowledgmentCannotCrossProfileReplacement() async throws {
        let fixture = try TVSilentProgressFixture()
        defer { fixture.remove() }
        let progress = TVProgressProbe()
        let model = makeModel(fixture, progress: progress)
        await load(model, profile: "a")
        model.noteUserNavigation(to: milliseconds(40_000))
        await fulfillment(of: [progress.firstSave], timeout: 2)
        await load(model, profile: "b")
        let replacement = try XCTUnwrap(model.player)
        await progress.resolveFirstSave()
        model.noteUserNavigation(to: milliseconds(10_000))
        await fulfillment(of: [progress.secondSave], timeout: 2)

        let writes = await progress.writes
        XCTAssertTrue(model.player === replacement)
        XCTAssertEqual(writes.last?.profile, "b")
        XCTAssertEqual(writes.last?.revision, TVProgressProbe.reviewRevision)
        XCTAssertFalse(model.progressNeedsReview)
        await model.stop(saveProgress: false)
    }

    func testFailedInitialReadRequiresExplicitReviewBeforeAnyCheckpoint() async throws {
        let fixture = try TVSilentProgressFixture()
        defer { fixture.remove() }
        let progress = TVProgressProbe(failInitialRead: true)
        let model = makeModel(fixture, progress: progress)
        await load(model, profile: "a")
        XCTAssertTrue(model.progressNeedsReview)
        model.noteUserNavigation(to: milliseconds(30_000))
        model.handleScene(active: false)
        let unexpected = expectation(description: "An unresolved baseline cannot write")
        unexpected.isInverted = true
        await progress.rejectUnexpectedWrites(using: unexpected)
        await fulfillment(of: [unexpected], timeout: 0.2)
        let reads = await progress.reads
        let writes = await progress.writes
        XCTAssertEqual(reads, 1)
        XCTAssertTrue(writes.isEmpty)
        model.reviewProgress()
        await waitForRead(model)
        XCTAssertFalse(model.progressNeedsReview)
        await model.stop(saveProgress: false)
    }

    func testSharedStateRequiresReadEvenWhenBackwardNavigationIsAllowed() throws {
        var state = ProgressRevisionState()
        XCTAssertNil(state.beginSave(positionMs: 40_000, allowsBackward: true))
        let read = state.beginRead()
        state.accept(snapshot(60_000, revision: TVProgressProbe.firstRevision), for: read)
        XCTAssertNil(state.beginSave(positionMs: 40_000))
        let write = try XCTUnwrap(state.beginSave(positionMs: 40_000, allowsBackward: true))
        XCTAssertEqual(write.expectedRevision, TVProgressProbe.firstRevision)
        XCTAssertNil(state.beginSave(positionMs: 30_000, allowsBackward: true))
        state.fail(write)
        XCTAssertNil(state.beginSave(positionMs: 20_000, allowsBackward: true))
        let review = state.beginRead()
        state.accept(snapshot(90_000, revision: TVProgressProbe.reviewRevision), for: review)
        XCTAssertNil(state.beginSave(positionMs: 20_000))
        XCTAssertEqual(state.beginSave(positionMs: 30_000, allowsBackward: true)?.expectedRevision,
                       TVProgressProbe.reviewRevision)
    }

    func testFirstWriteRetainsExplicitNullRevisionAndOldTicketCannotReplaceReset() throws {
        var state = ProgressRevisionState()
        let read = state.beginRead()
        state.accept(snapshot(0, revision: nil), for: read)
        let write = try XCTUnwrap(state.beginSave(positionMs: 5_000))
        XCTAssertNil(write.expectedRevision)
        state.reset()
        let replacement = state.beginRead()
        state.accept(snapshot(90_000, revision: TVProgressProbe.reviewRevision), for: replacement)
        XCTAssertFalse(state.accept(snapshot(5_000, revision: TVProgressProbe.ackRevision), for: write))
        XCTAssertFalse(state.fail(write))
        XCTAssertEqual(state.snapshot?.positionMs, 90_000)
    }


    func testViewerReplacementConcealsImmediatelyAndFencesHeldPlayback() async throws {
        let original = TVViewerScope(token: "token", account: "account", profile: "profile", isKids: false)
        let replacements: [TVViewerScope] = [
            .init(token: "new-token", account: "account", profile: "profile", isKids: false),
            .init(token: "token", account: "new-account", profile: "profile", isKids: false),
            .init(token: "token", account: "account", profile: "new-profile", isKids: false),
            .init(token: "token", account: "account", profile: "profile", isKids: true),
            .init(token: nil, account: nil, profile: nil, isKids: false)
        ]
        for replacementScope in replacements {
            let fixture = try TVSilentProgressFixture()
            defer { fixture.remove() }
            let service = TVHeldViewerPlayback(playback: fixture.playback)
            let model = TVPlayerViewModel(destination: .video(slug: "progress-test", isKids: false),
                                          service: service, progress: TVProgressProbe(), analytics: TVQuietAnalytics())
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
            XCTAssertTrue(model.captionTracks.isEmpty)
            XCTAssertTrue(model.subtitleText.isEmpty)
        }
    }

    func testRestorationInvalidationDiscardsHeldMediaAndFailure() async throws {
        for reject in [false, true] {
            let fixture = try TVSilentProgressFixture()
            defer { fixture.remove() }
            let service = TVHeldViewerPlayback(playback: fixture.playback)
            let model = TVPlayerViewModel(destination: .video(slug: "progress-test", isKids: false),
                                          service: service, progress: TVProgressProbe(), analytics: TVQuietAnalytics())
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
        let fixture = try TVSilentProgressFixture()
        defer { fixture.remove() }
        let service = TVHeldViewerPlayback(playback: fixture.playback)
        let model = TVPlayerViewModel(destination: .video(slug: "progress-test", isKids: false),
                                          service: service, progress: TVProgressProbe(), analytics: TVQuietAnalytics())
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
        let fixture = try TVSilentProgressFixture()
        defer { fixture.remove() }
        let service = TVHeldViewerPlayback(playback: fixture.playback)
        let progress = TVProgressProbe()
        let model = TVPlayerViewModel(destination: .video(slug: "adult", isKids: false),
                                      service: service, progress: progress, analytics: TVQuietAnalytics())
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

    func testVideoDetailForwardsViewerAndDiscardsOldPolicyFailure() async throws {
        let fixture = try TVSilentProgressFixture()
        defer { fixture.remove() }
        let service = TVHeldViewerPlayback(playback: fixture.playback)
        let model = TVDetailViewModel(playback: service)
        let route = TVRoute.video(slug: "show", isKids: false)
        let pending = Task {
            await model.load(route, token: "token", accountId: "account", profileId: "adult", isKids: false)
        }
        await fulfillment(of: [service.started], timeout: 2)
        model.viewerDidChange(token: "token", accountId: "account", profileId: "child", isKids: true)
        XCTAssertNil(model.video)
        await model.load(route, token: "token", accountId: "account", profileId: "child", isKids: true)
        await service.release(reject: true)
        await pending.value
        XCTAssertNotNil(model.video)
        XCTAssertNil(model.errorMessage)
        let requests = await service.requests
        XCTAssertEqual(requests, [
            .init(token: "token", account: "account", profile: "adult", isKids: false),
            .init(token: "token", account: "account", profile: "child", isKids: true)
        ])
        model.invalidateViewer()
        XCTAssertNil(model.video)
    }

    private func makeModel(_ fixture: TVSilentProgressFixture, progress: TVProgressProbe) -> TVPlayerViewModel {
        TVPlayerViewModel(destination: .video(slug: "progress-test", isKids: false),
                          service: TVFixturePlayback(playback: fixture.playback),
                          progress: progress, analytics: TVQuietAnalytics())
    }

    private func load(_ model: TVPlayerViewModel, profile: String) async {
        await model.load(token: "token-\(profile)", profileId: profile)
        model.player?.pause()
        XCTAssertNotNil(model.player)
        XCTAssertNil(model.errorMessage)
        await waitForRead(model)
    }

    private func waitForRead(_ model: TVPlayerViewModel) async {
        let done = expectation(description: "Baseline read settled")
        let observation = model.$isReviewingProgress.filter { !$0 }.first().sink { _ in done.fulfill() }
        await fulfillment(of: [done], timeout: 2)
        withExtendedLifetime(observation) {}
    }

    private func waitForReview(_ model: TVPlayerViewModel) async {
        let done = expectation(description: "Failed checkpoint requires review")
        let observation = model.$progressNeedsReview.filter { $0 }.first().sink { _ in done.fulfill() }
        await fulfillment(of: [done], timeout: 2)
        withExtendedLifetime(observation) {}
    }

    private func milliseconds(_ value: Int) -> CMTime {
        CMTime(value: Int64(value), timescale: 1_000)
    }

    private func snapshot(_ position: Int, revision: String?) -> WatchProgress {
        WatchProgress(profileId: "a", videoId: "video", positionMs: position,
                      completedAt: nil, revision: revision)
    }
}


private struct TVViewerScope: Equatable {
    let token: String?
    let account: String?
    let profile: String?
    let isKids: Bool
}

private actor TVHeldViewerPlayback: TVPlaybackServicing {
    nonisolated let started = XCTestExpectation(description: "Playback response is held")
    private let playback: TVPlaybackAsset
    private(set) var requests: [TVViewerScope] = []
    private var continuation: CheckedContinuation<TVPlaybackAsset, Error>?

    init(playback: TVPlaybackAsset) { self.playback = playback }

    func load(_ destination: TVPlaybackDestination, token: String?, accountId: String?,
              profileId: String?, isKids: Bool) async throws -> TVPlaybackAsset {
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

private actor TVProgressProbe: WatchProgressServicing {
    struct Write { let profile: String?; let position: Int; let revision: String? }
    static let firstRevision = "2026-10-06T08:00:00.001Z"
    static let ackRevision = "2026-10-06T08:00:00.002Z"
    static let reviewRevision = "2026-10-06T08:00:00.009Z"
    nonisolated let firstSave = XCTestExpectation(description: "First checkpoint is pending")
    nonisolated let secondSave = XCTestExpectation(description: "Second checkpoint started")
    private(set) var writes: [Write] = []
    private(set) var reads = 0
    private let failInitialRead: Bool
    private var continuation: CheckedContinuation<WatchProgress, Error>?
    private var unexpectedWrites: XCTestExpectation?

    init(failInitialRead: Bool = false) { self.failInitialRead = failInitialRead }

    func progress(videoId: String, profileId: String?, token: String) async throws -> WatchProgress {
        reads += 1
        if failInitialRead && reads == 1 { throw URLError(.notConnectedToInternet) }
        return WatchProgress(profileId: profileId ?? "", videoId: videoId,
                             positionMs: reads == 1 ? 60_000 : 90_000,
                             completedAt: "2026-10-06T08:00:00.000Z",
                             revision: reads == 1 ? Self.firstRevision : Self.reviewRevision)
    }

    func save(videoId: String, profileId: String?, positionMs: Int, durationMs: Int?,
              expectedRevision: String?, token: String) async throws -> WatchProgress {
        writes.append(Write(profile: profileId, position: positionMs, revision: expectedRevision))
        unexpectedWrites?.fulfill()
        if writes.count == 1 {
            return try await withCheckedThrowingContinuation {
                continuation = $0
                firstSave.fulfill()
            }
        }
        secondSave.fulfill()
        return WatchProgress(profileId: profileId ?? "", videoId: videoId, positionMs: positionMs,
                             completedAt: nil, revision: "2026-10-06T08:00:00.010Z")
    }

    func resolveFirstSave(error: Error? = nil) {
        guard let continuation, let first = writes.first else { return }
        self.continuation = nil
        if let error { continuation.resume(throwing: error) }
        else {
            continuation.resume(returning: WatchProgress(profileId: first.profile ?? "", videoId: "video",
                                                        positionMs: first.position, completedAt: nil,
                                                        revision: Self.ackRevision))
        }
    }

    func rejectUnexpectedWrites(using expectation: XCTestExpectation?) { unexpectedWrites = expectation }
}

private struct TVFixturePlayback: TVPlaybackServicing {
    let playback: TVPlaybackAsset
    func load(_ destination: TVPlaybackDestination, token: String?, accountId: String?,
              profileId: String?, isKids: Bool) async throws -> TVPlaybackAsset { playback }
}

private struct TVQuietAnalytics: TVAnalyticsTracking {
    func emit(_ eventName: String, profileId: String?, videoId: String?, channelId: String?,
              durationDeltaMs: Int?, positionMs: Int?, metadata: [String: String]) async {}
}

private struct TVSilentProgressFixture {
    let url: URL
    init() throws {
        url = FileManager.default.temporaryDirectory.appendingPathComponent("ayin-tv-\(UUID().uuidString).wav")
        let byteCount: UInt32 = 8_000 * 2 * 120
        var data = Data("RIFF".utf8)
        func append<T: FixedWidthInteger>(_ value: T) {
            var littleEndian = value.littleEndian
            withUnsafeBytes(of: &littleEndian) { data.append(contentsOf: $0) }
        }
        append(byteCount + 36)
        data.append(Data("WAVEfmt ".utf8))
        append(UInt32(16)); append(UInt16(1)); append(UInt16(1))
        append(UInt32(8_000)); append(UInt32(16_000)); append(UInt16(2)); append(UInt16(16))
        data.append(Data("data".utf8))
        append(byteCount)
        data.append(Data(count: Int(byteCount)))
        try data.write(to: url)
    }
    var playback: TVPlaybackAsset {
        TVPlaybackAsset(title: "Progress fixture", subtitle: nil, primaryURL: url, fallbackURL: nil,
                        shareURL: URL(string: "https://ayin.stream/watch/progress-test")!, videoId: "video",
                        channelId: "channel", durationMs: 120_000, isLive: false, protocolName: "MP4",
                        initialOffsetMs: 0, captions: [], isKids: false)
    }
    func remove() { try? FileManager.default.removeItem(at: url) }
}
