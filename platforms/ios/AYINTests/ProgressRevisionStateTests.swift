import XCTest
@testable import AYIN

final class ProgressRevisionStateTests: XCTestCase {
    private func progress(_ position: Int, _ revision: String? = "2026-10-06T08:00:00.001Z") -> WatchProgress {
        WatchProgress(profileId: "profile", videoId: "video", positionMs: position, completedAt: nil, revision: revision)
    }

    func testNoWriteBeforeAuthoritativeReadAndFirstWriteKeepsNullRevision() throws {
        var state = ProgressRevisionState()
        XCTAssertNil(state.beginSave(positionMs: 5000))
        let read = state.beginRead()
        XCTAssertTrue(state.accept(progress(0, nil), for: read))
        let write = try XCTUnwrap(state.beginSave(positionMs: 5000))
        XCTAssertNil(write.expectedRevision)
        XCTAssertNil(state.beginSave(positionMs: 6000))
    }

    func testAcknowledgedRevisionBecomesTheNextExpectedRevision() throws {
        var state = ProgressRevisionState()
        let read = state.beginRead()
        state.accept(progress(10000), for: read)
        let first = try XCTUnwrap(state.beginSave(positionMs: 15000))
        XCTAssertEqual(first.expectedRevision, "2026-10-06T08:00:00.001Z")
        state.accept(progress(15000, "2026-10-06T08:00:00.002Z"), for: first)
        XCTAssertEqual(state.beginSave(positionMs: 20000)?.expectedRevision, "2026-10-06T08:00:00.002Z")
    }

    func testConflictOrUnknownWriteRequiresReadAndNeverReplaysOldPosition() throws {
        var state = ProgressRevisionState()
        let read = state.beginRead()
        state.accept(progress(10000), for: read)
        let write = try XCTUnwrap(state.beginSave(positionMs: 15000))
        state.fail(write)
        XCTAssertTrue(state.requiresReview)
        XCTAssertNil(state.beginSave(positionMs: 20000))
        let review = state.beginRead()
        XCTAssertNil(state.beginSave(positionMs: 25000))
        state.accept(progress(60000, "2026-10-06T08:00:00.099Z"), for: review)
        XCTAssertFalse(state.requiresReview)
        XCTAssertNil(state.beginSave(positionMs: 25000))
        XCTAssertEqual(state.beginSave(positionMs: 65000)?.expectedRevision, "2026-10-06T08:00:00.099Z")
    }

    func testLateReadAndWriteCannotCrossSessionReset() throws {
        var state = ProgressRevisionState()
        let oldRead = state.beginRead()
        state.reset()
        XCTAssertFalse(state.accept(progress(10000), for: oldRead))
        let currentRead = state.beginRead()
        state.accept(progress(0, nil), for: currentRead)
        let oldWrite = try XCTUnwrap(state.beginSave(positionMs: 5000))
        state.reset()
        let nextRead = state.beginRead()
        state.accept(progress(90000), for: nextRead)
        XCTAssertFalse(state.accept(progress(5000), for: oldWrite))
        XCTAssertFalse(state.fail(oldWrite))
        XCTAssertEqual(state.snapshot?.positionMs, 90000)
        XCTAssertFalse(state.requiresReview)
    }

    func testSupersededReadCannotReplaceNewerRead() {
        var state = ProgressRevisionState()
        let first = state.beginRead()
        let second = state.beginRead()
        XCTAssertFalse(state.accept(progress(1000), for: first))
        XCTAssertTrue(state.accept(progress(2000), for: second))
        XCTAssertEqual(state.snapshot?.positionMs, 2000)
    }
}
