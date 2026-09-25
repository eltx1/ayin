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
