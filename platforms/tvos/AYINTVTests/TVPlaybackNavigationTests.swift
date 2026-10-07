import AVFoundation
import Combine
import XCTest
@testable import AYINTV

@MainActor
final class TVPlaybackNavigationTests: XCTestCase {
    func testNextEpisodeRequiresCurrentSeriesVideoAndTrustedWatchRoute() throws {
        let fixture = try TVNavigationFixture()
        defer { fixture.remove() }
        XCTAssertEqual(fixture.asset().nextEpisodeDestination, .video(slug: "second", isKids: false))
        XCTAssertNil(fixture.asset(isKids: true).nextEpisodeDestination)
        XCTAssertNil(fixture.asset(isLive: true).nextEpisodeDestination)
        for href in ["https://other.test/watch/second", "/live/second", "/watch/wrong", "/watch/first"] {
            var asset = fixture.asset()
            asset.nextEpisode = .init(title: "Second", episodeNumber: 2, seasonNumber: 1,
                                      video: .init(id: "second-id", slug: "second", href: href))
            XCTAssertNil(asset.nextEpisodeDestination)
        }
        var unrelated = fixture.asset()
        unrelated.seriesContext = .init(
            series: .init(title: "Series", slug: "series", href: "/series/series"),
            episode: .init(title: "Wrong", episodeNumber: 1, seasonNumber: nil,
                           video: .init(id: "another-video", slug: "first", href: "/watch/first"))
        )
        XCTAssertNil(unrelated.nextEpisodeDestination)
        unrelated.seriesContext = nil
        XCTAssertNil(unrelated.nextEpisodeDestination)
        unrelated = fixture.asset()
        unrelated.nextEpisode = nil
        XCTAssertNil(unrelated.nextEpisodeDestination, "A final episode does not invent a continuation")
        var kidsLink = fixture.asset()
        kidsLink.nextEpisode = .init(title: "Second", episodeNumber: 2, seasonNumber: 1,
                                     video: .init(id: "second-id", slug: "second", href: "/watch/second?kids=1"))
        XCTAssertEqual(kidsLink.nextEpisodeDestination, .video(slug: "second", isKids: true))
    }

    func testChapterSeekWinsOverHeldResumeWithoutResumingPausedPlayback() async throws {
        let fixture = try TVNavigationFixture()
        defer { fixture.remove() }
        let service = TVNavigationPlayback(fixture: fixture)
        let progress = TVNavigationProgress(holdRead: true)
        let model = makeModel(service: service, progress: progress)
        await load(model)
        await fulfillment(of: [progress.readStarted], timeout: 2)
        let player = try XCTUnwrap(model.player)
        let context = try XCTUnwrap(model.controlContext)
        await waitUntilReady(player)
        player.pause()
        await model.seekChapter("middle", context: context)
        await progress.releaseRead()
        await waitForRead(model)
        XCTAssertEqual(CMTimeGetSeconds(player.currentTime()), 20, accuracy: 0.2)
        XCTAssertEqual(player.timeControlStatus, .paused)
        await model.stop(saveProgress: false)
    }

    func testNextEpisodeWaitsForCheckpointAndUsesFreshScopedPlaybackRequestOnlyOnce() async throws {
        let fixture = try TVNavigationFixture()
        defer { fixture.remove() }
        let service = TVNavigationPlayback(fixture: fixture)
        let progress = TVNavigationProgress(holdSave: true)
        let model = makeModel(service: service, progress: progress)
        await load(model)
        await waitForRead(model)
        let player = try XCTUnwrap(model.player)
        await waitUntilReady(player)
        player.pause()
        let context = try XCTUnwrap(model.controlContext)
        await model.seekChapter("middle", context: context)
        await fulfillment(of: [progress.saveStarted], timeout: 2)
        let next = Task { await model.playNextEpisode(context: context) }
        await waitForRetiredContext(model, context: context)
        let staleTarget = CMTime(value: 5_000, timescale: 1_000)
        model.noteUserNavigation(to: staleTarget, context: context)
        // Even a delegate delivered during teardown cannot rewrite the final checkpoint.
        model.noteUserNavigation(to: staleTarget)
        XCTAssertNil(model.player)
        XCTAssertNil(player.currentItem, "Media must detach before awaiting the checkpoint")
        player.play()
        XCTAssertNil(player.currentItem, "A late AVKit Play cannot revive the finished item")
        await model.playNextEpisode(context: context)
        let before = await service.requests
        XCTAssertEqual(before.count, 1, "The old checkpoint must settle before the next authorization")
        await progress.releaseSave()
        await next.value

        let requests = await service.requests
        XCTAssertEqual(requests.map(\.destination), [
            .video(slug: "first", isKids: false), .video(slug: "second", isKids: false)
        ])
        XCTAssertTrue(requests.allSatisfy {
            $0.token == "token" && $0.account == "account" && $0.profile == "profile" && !$0.isKids
        })
        XCTAssertEqual(model.destination, .video(slug: "second", isKids: false))
        XCTAssertEqual(model.playback?.videoId, "second-id")
        XCTAssertNil(model.playback?.nextEpisodeDestination)
        let positions = await progress.savedPositions
        XCTAssertEqual(positions, [20_000, 20_000], "Retired navigation cannot replace the current-item checkpoint")
        await model.stop(saveProgress: false)
    }

    func testViewerReplacementWhileNextCheckpointIsHeldCannotRequestOldViewerEpisode() async throws {
        let fixture = try TVNavigationFixture()
        defer { fixture.remove() }
        let service = TVNavigationPlayback(fixture: fixture)
        let progress = TVNavigationProgress(holdSave: true)
        let model = makeModel(service: service, progress: progress)
        await load(model)
        await waitForRead(model)
        let context = try XCTUnwrap(model.controlContext)
        model.noteUserNavigation(to: CMTime(value: 40_000, timescale: 1_000))
        await fulfillment(of: [progress.saveStarted], timeout: 2)
        let next = Task { await model.playNextEpisode(context: context) }
        await waitForRetiredContext(model, context: context)
        model.viewerDidChange(token: "replacement", accountId: "account", profileId: "child", isKids: true)
        await progress.releaseSave()
        await next.value
        XCTAssertNil(model.player)
        XCTAssertNil(model.playback)
        let requests = await service.requests
        XCTAssertEqual(requests.count, 1)
        XCTAssertEqual(model.destination, .video(slug: "first", isKids: false))
    }

    func testOrdinaryStopBlocksSameViewerReloadUntilOldCheckpointsDrain() async throws {
        let fixture = try TVNavigationFixture()
        defer { fixture.remove() }
        let service = TVNavigationPlayback(fixture: fixture)
        let progress = TVNavigationProgress(holdSave: true)
        let model = makeModel(service: service, progress: progress)
        await load(model)
        await waitForRead(model)
        let player = try XCTUnwrap(model.player)
        await waitUntilReady(player)
        player.pause()
        let context = try XCTUnwrap(model.controlContext)
        await model.seekChapter("middle", context: context)
        await fulfillment(of: [progress.saveStarted], timeout: 2)

        let stopping = Task { await model.stop() }
        await waitForRetiredContext(model, context: context)
        XCTAssertNil(player.currentItem)
        XCTAssertTrue(model.isLoading)
        await load(model)
        let whileDraining = await service.requests
        XCTAssertEqual(whileDraining.count, 1, "Same-viewer loading cannot reuse the retiring checkpoint worker")
        await progress.releaseSave()
        let stopped = await stopping.value
        XCTAssertTrue(stopped)
        XCTAssertFalse(model.isLoading)
        XCTAssertNil(model.player)
        let positions = await progress.savedPositions
        XCTAssertEqual(positions, [20_000, 20_000])

        await load(model)
        let afterStop = await service.requests
        XCTAssertEqual(afterStop.count, 2)
        XCTAssertNotNil(model.player)
        await model.stop(saveProgress: false)
    }

    func testHeldNextResponseAndOldMenuActionsCannotReplaceNewViewer() async throws {
        let fixture = try TVNavigationFixture()
        defer { fixture.remove() }
        let service = TVNavigationPlayback(fixture: fixture, holdSecond: true)
        let model = makeModel(service: service, progress: TVNavigationProgress())
        await load(model)
        await waitForRead(model)
        let context = try XCTUnwrap(model.controlContext)
        let next = Task { await model.playNextEpisode(context: context) }
        await fulfillment(of: [service.secondStarted], timeout: 2)
        model.viewerDidChange(token: "replacement", accountId: "account", profileId: "child", isKids: true)
        await model.load(token: "replacement", profileId: "child", accountId: "account", isKids: true)
        let replacement = try XCTUnwrap(model.player)
        replacement.pause()
        await service.releaseSecond()
        await next.value
        await model.seekChapter("middle", context: context)
        await model.selectCaption("old-track", context: context)
        await model.playNextEpisode(context: context)
        XCTAssertTrue(model.player === replacement)
        XCTAssertTrue(model.playback?.isKids == true)
        XCTAssertNil(model.selectedCaptionId)
        XCTAssertLessThan(CMTimeGetSeconds(replacement.currentTime()), 1)
        let requests = await service.requests
        XCTAssertEqual(requests.count, 3)
        await model.stop(saveProgress: false)
    }

    func testNextEpisodeRespectsSceneDepartureDuringHeldResponse() async throws {
        let fixture = try TVNavigationFixture()
        defer { fixture.remove() }
        let service = TVNavigationPlayback(fixture: fixture, holdSecond: true)
        let model = makeModel(service: service, progress: TVNavigationProgress())
        await load(model)
        await waitForRead(model)
        let context = try XCTUnwrap(model.controlContext)
        let next = Task { await model.playNextEpisode(context: context) }
        await fulfillment(of: [service.secondStarted], timeout: 2)
        model.handleScene(active: false)
        await service.releaseSecond()
        await next.value
        XCTAssertEqual(model.player?.timeControlStatus, .paused)
        await model.stop(saveProgress: false)
    }

    private func makeModel(service: TVNavigationPlayback, progress: TVNavigationProgress) -> TVPlayerViewModel {
        TVPlayerViewModel(destination: .video(slug: "first", isKids: false), service: service,
                          progress: progress, analytics: TVNavigationAnalytics())
    }

    private func load(_ model: TVPlayerViewModel) async {
        await model.load(token: "token", profileId: "profile", accountId: "account")
    }

    private func waitForRead(_ model: TVPlayerViewModel) async {
        let done = expectation(description: "Progress read settled")
        let observation = model.$isReviewingProgress.filter { !$0 }.first().sink { _ in done.fulfill() }
        await fulfillment(of: [done], timeout: 2)
        withExtendedLifetime(observation) {}
    }

    private func waitForRetiredContext(_ model: TVPlayerViewModel, context: TVPlaybackControlContext) async {
        let retired = expectation(description: "Navigation retired the original menu context")
        let observation = model.$isLoading.filter { _ in model.controlContext != context }
            .first().sink { _ in retired.fulfill() }
        await fulfillment(of: [retired], timeout: 2)
        withExtendedLifetime(observation) {}
    }

    private func waitUntilReady(_ player: AVPlayer) async {
        let ready = expectation(description: "Local media ready")
        let observation = player.currentItem?.publisher(for: \.status)
            .filter { $0 == .readyToPlay }.first().sink { _ in ready.fulfill() }
        await fulfillment(of: [ready], timeout: 3)
        withExtendedLifetime(observation) {}
    }
}

private actor TVNavigationPlayback: TVPlaybackServicing {
    struct Request {
        let destination: TVPlaybackDestination
        let token: String?
        let account: String?
        let profile: String?
        let isKids: Bool
    }
    nonisolated let secondStarted = XCTestExpectation(description: "Next playback response held")
    private(set) var requests: [Request] = []
    private let fixture: TVNavigationFixture
    private let holdSecond: Bool
    private var continuation: CheckedContinuation<TVPlaybackAsset, Never>?

    init(fixture: TVNavigationFixture, holdSecond: Bool = false) {
        self.fixture = fixture
        self.holdSecond = holdSecond
    }

    func load(_ destination: TVPlaybackDestination, token: String?, accountId: String?,
              profileId: String?, isKids: Bool) async throws -> TVPlaybackAsset {
        requests.append(.init(destination: destination, token: token, account: accountId,
                              profile: profileId, isKids: isKids))
        if requests.count == 2, holdSecond {
            return await withCheckedContinuation {
                continuation = $0
                secondStarted.fulfill()
            }
        }
        return fixture.asset(second: destination == .video(slug: "second", isKids: false), isKids: isKids)
    }

    func releaseSecond() {
        continuation?.resume(returning: fixture.asset(second: true))
        continuation = nil
    }
}

private actor TVNavigationProgress: WatchProgressServicing {
    nonisolated let readStarted = XCTestExpectation(description: "Initial progress read held")
    nonisolated let saveStarted = XCTestExpectation(description: "Current progress checkpoint held")
    private let holdRead: Bool
    private let holdSave: Bool
    private var readContinuation: CheckedContinuation<WatchProgress, Never>?
    private var saveContinuation: CheckedContinuation<WatchProgress, Never>?
    private var saved: WatchProgress?
    private(set) var savedPositions: [Int] = []

    init(holdRead: Bool = false, holdSave: Bool = false) {
        self.holdRead = holdRead
        self.holdSave = holdSave
    }

    func progress(videoId: String, profileId: String?, token: String) async throws -> WatchProgress {
        if holdRead {
            return await withCheckedContinuation {
                readContinuation = $0
                readStarted.fulfill()
            }
        }
        return WatchProgress(profileId: profileId ?? "", videoId: videoId, positionMs: 0,
                             completedAt: nil, revision: "r1")
    }

    func save(videoId: String, profileId: String?, positionMs: Int, durationMs: Int?,
              expectedRevision: String?, token: String) async throws -> WatchProgress {
        savedPositions.append(positionMs)
        let result = WatchProgress(profileId: profileId ?? "", videoId: videoId, positionMs: positionMs,
                                   completedAt: nil, revision: "r2")
        if holdSave, saved == nil {
            saved = result
            return await withCheckedContinuation {
                saveContinuation = $0
                saveStarted.fulfill()
            }
        }
        return result
    }

    func releaseRead() {
        readContinuation?.resume(returning: WatchProgress(profileId: "profile", videoId: "first-id",
                                                          positionMs: 70_000, completedAt: nil, revision: "r1"))
        readContinuation = nil
    }

    func releaseSave() {
        if let saved { saveContinuation?.resume(returning: saved) }
        saveContinuation = nil
    }
}

private struct TVNavigationAnalytics: TVAnalyticsTracking {
    func emit(_ eventName: String, profileId: String?, videoId: String?, channelId: String?,
              durationDeltaMs: Int?, positionMs: Int?, metadata: [String: String]) async {}
}

private struct TVNavigationFixture {
    let url: URL

    init() throws {
        url = FileManager.default.temporaryDirectory.appendingPathComponent("ayin-tv-navigation-\(UUID().uuidString).wav")
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

    func asset(second: Bool = false, isKids: Bool = false, isLive: Bool = false) -> TVPlaybackAsset {
        TVPlaybackAsset(
            title: second ? "Second" : "First", subtitle: "Channel", primaryURL: url, fallbackURL: nil,
            shareURL: URL(string: "https://ayin.stream/watch/\(second ? "second" : "first")")!,
            videoId: second ? "second-id" : "first-id", channelId: "channel", durationMs: 120_000,
            isLive: isLive, protocolName: "MP4", initialOffsetMs: 0, captions: [], isKids: isKids,
            chapters: [.init(id: "intro", title: "Intro", startMs: 0),
                       .init(id: "middle", title: "Middle", startMs: 20_000)],
            seriesContext: second ? nil : .init(
                series: .init(title: "Series", slug: "series", href: "/series/series"),
                episode: .init(title: "First", episodeNumber: 1, seasonNumber: nil,
                               video: .init(id: "first-id", slug: "first", href: "/watch/first"))
            ),
            nextEpisode: second ? nil : .init(
                title: "Second", episodeNumber: 2, seasonNumber: 1,
                video: .init(id: "second-id", slug: "second", href: "/watch/second")
            )
        )
    }

    func remove() { try? FileManager.default.removeItem(at: url) }
}
