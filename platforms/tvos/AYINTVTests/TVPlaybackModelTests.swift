import XCTest
@testable import AYINTV

final class TVPlaybackModelTests: XCTestCase {
    func testOlderAndStandalonePlaybackRemainCompatibleWithoutNavigationFields() throws {
        let response = try JSONDecoder().decode(TVVideoPlaybackResponse.self, from: Data("""
        {"video":{"id":"video","slug":"show","title":"Show","durationMs":60000,
          "channel":{"id":"channel","handle":"channel","name":"Channel"},
          "source":{"objectKey":"show.mp4","mimeType":"video/mp4"},"captions":[]}}
        """.utf8))
        XCTAssertNil(response.video.chapters)
        XCTAssertNil(response.detail)
    }

    func testChapterChoicesAreBoundedOrderedAndWithinDuration() {
        let chapters: [TVPlaybackChapter] = [
            .init(id: "negative", title: "Negative", startMs: -1),
            .init(id: "intro", title: "Intro", startMs: 0),
            .init(id: "intro", title: "Duplicate", startMs: 1_000),
            .init(id: "blank", title: "  ", startMs: 2_000),
            .init(id: "middle", title: "Middle", startMs: 20_000),
            .init(id: "backwards", title: "Earlier", startMs: 10_000),
            .init(id: "end", title: "End", startMs: 60_000)
        ]
        XCTAssertEqual(TVPlaybackChapter.available(chapters, durationMs: 60_000).map(\.id),
                       ["intro", "middle"])
        let many = (0..<120).map { TVPlaybackChapter(id: "chapter-\($0)", title: "Title", startMs: $0 * 1_000) }
        XCTAssertEqual(TVPlaybackChapter.available(many, durationMs: nil).count, 100)
    }

    func testHLSVODKeepsMP4Fallback() throws {
        let asset = TVPlaybackAsset(
            title: "Example",
            subtitle: "Channel",
            primaryURL: try XCTUnwrap(URL(string: "https://media.ayin.stream/video/master.m3u8")),
            fallbackURL: try XCTUnwrap(URL(string: "https://media.ayin.stream/video/fallback.mp4")),
            shareURL: try XCTUnwrap(URL(string: "https://ayin.stream/watch/example")),
            videoId: "video-id",
            channelId: "channel-id",
            durationMs: 60_000,
            isLive: false,
            protocolName: "HLS",
            initialOffsetMs: 0,
            captions: [],
            isKids: false
        )

        let fallback = try XCTUnwrap(asset.mp4Fallback())
        XCTAssertEqual(fallback.protocolName, "MP4")
        XCTAssertNil(fallback.fallbackURL)
        XCTAssertTrue(fallback.primaryURL.absoluteString.hasSuffix("fallback.mp4"))
    }

    func testSceneResumeIntentSurvivesInactiveThenBackground() {
        var state = TVSceneResumeState()

        XCTAssertTrue(state.leaveActive(shouldResumePlayback: true))
        XCTAssertFalse(state.leaveActive(shouldResumePlayback: false))
        XCTAssertTrue(state.enterActive())
        XCTAssertFalse(state.enterActive())
    }

    func testBufferingPlaybackIntentResumesAfterSceneReturn() {
        var state = TVSceneResumeState()

        XCTAssertTrue(state.leaveActive(shouldResumePlayback: true))
        XCTAssertTrue(state.enterActive())
        XCTAssertFalse(state.enterActive())
    }

    func testSlowResumeStillAppliesUntilViewerNavigates() {
        XCTAssertTrue(
            TVResumePolicy.shouldApplySavedPosition(
                positionMs: 90_000,
                completedAt: nil,
                userNavigated: false
            )
        )
        XCTAssertFalse(
            TVResumePolicy.shouldApplySavedPosition(
                positionMs: 90_000,
                completedAt: nil,
                userNavigated: true
            )
        )
        XCTAssertFalse(
            TVResumePolicy.shouldApplySavedPosition(
                positionMs: 90_000,
                completedAt: "2026-09-26T00:00:00Z",
                userNavigated: false
            )
        )
    }

    func testPiPKeepsPlaybackAliveWhileSceneIsInactive() {
        XCTAssertFalse(
            TVPlaybackScenePolicy.shouldPause(
                sceneIsActive: false,
                pictureInPictureActive: true
            )
        )
        XCTAssertTrue(
            TVPlaybackScenePolicy.shouldPause(
                sceneIsActive: false,
                pictureInPictureActive: false
            )
        )
        XCTAssertFalse(
            TVPlaybackScenePolicy.shouldPause(
                sceneIsActive: true,
                pictureInPictureActive: false
            )
        )
    }

    func testProgressPersistenceSupportsBackwardSeekAndForcedExitSave() {
        XCTAssertTrue(
            TVProgressPersistence.shouldSave(
                lastSavedPositionMs: 60_000,
                currentPositionMs: 40_000,
                force: false
            )
        )
        XCTAssertTrue(
            TVProgressPersistence.shouldSave(
                lastSavedPositionMs: 60_000,
                currentPositionMs: 59_000,
                force: true
            )
        )
        XCTAssertFalse(
            TVProgressPersistence.shouldSave(
                lastSavedPositionMs: 60_000,
                currentPositionMs: 62_000,
                force: false
            )
        )
    }

    func testLiveAssetNeverPretendsProgressiveFallback() throws {
        let asset = TVPlaybackAsset(
            title: "Live",
            subtitle: nil,
            primaryURL: try XCTUnwrap(URL(string: "https://media.ayin.stream/live/master.m3u8")),
            fallbackURL: try XCTUnwrap(URL(string: "https://media.ayin.stream/live/fallback.mp4")),
            shareURL: try XCTUnwrap(URL(string: "https://ayin.stream/live/main")),
            videoId: nil,
            channelId: "channel-id",
            durationMs: nil,
            isLive: true,
            protocolName: "HLS",
            initialOffsetMs: 0,
            captions: [],
            isKids: false
        )

        XCTAssertNil(asset.mp4Fallback())
    }
}
