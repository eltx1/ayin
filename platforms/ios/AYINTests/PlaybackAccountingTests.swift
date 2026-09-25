import XCTest
@testable import AYIN

final class PlaybackAccountingTests: XCTestCase {
    func testCountsAdvancingMediaPositionAsWatchDuration() {
        XCTAssertEqual(
            PlaybackAccounting.watchedDeltaMs(
                previousPositionMs: 10_000,
                currentPositionMs: 25_000
            ),
            15_000
        )
    }

    func testDoesNotCountPausedOrBackwardPosition() {
        XCTAssertEqual(
            PlaybackAccounting.watchedDeltaMs(
                previousPositionMs: 10_000,
                currentPositionMs: 10_000
            ),
            0
        )
        XCTAssertEqual(
            PlaybackAccounting.watchedDeltaMs(
                previousPositionMs: 10_000,
                currentPositionMs: 5_000
            ),
            0
        )
    }

    func testTreatsLargeForwardJumpAsSeekNotWatchTime() {
        XCTAssertEqual(
            PlaybackAccounting.watchedDeltaMs(
                previousPositionMs: 10_000,
                currentPositionMs: 90_000
            ),
            0
        )
    }

    func testCheckpointCoalescingKeepsOnlyNewestPosition() {
        let first = PlaybackAccounting.coalescedCheckpoint(
            existing: nil,
            positionMs: 15_000,
            forceProgressSave: false
        )
        let latest = PlaybackAccounting.coalescedCheckpoint(
            existing: first,
            positionMs: 45_000,
            forceProgressSave: false
        )

        XCTAssertEqual(latest.positionMs, 45_000)
        XCTAssertFalse(latest.forceProgressSave)
    }

    func testCheckpointCoalescingKeepsFinalSaveSticky() {
        let final = PlaybackAccounting.coalescedCheckpoint(
            existing: nil,
            positionMs: 45_000,
            forceProgressSave: true
        )
        let latest = PlaybackAccounting.coalescedCheckpoint(
            existing: final,
            positionMs: 46_000,
            forceProgressSave: false
        )

        XCTAssertEqual(latest.positionMs, 46_000)
        XCTAssertTrue(latest.forceProgressSave)
    }

    func testFirstSampleEstablishesBaselineWithoutInventingWatchTime() {
        XCTAssertEqual(
            PlaybackAccounting.watchedDeltaMs(
                previousPositionMs: nil,
                currentPositionMs: 15_000
            ),
            0
        )
    }
}
