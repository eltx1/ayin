import XCTest
@testable import AYIN

final class SharedVideoInboxTests: XCTestCase {
    func testIncomingVideoIsStreamCopiedAndNeverReferencesProviderTemporaryFile() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let source = root.appendingPathComponent("source.mp4")
        // Crosses the streaming chunk boundary; equality checks the actual owned bytes.
        let bytes = Data(repeating: 0x47, count: 1024 * 1024 + 13)
        try bytes.write(to: source)
        let inbox = SharedVideoInbox(directory: root.appendingPathComponent("inbox"))
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let record = try inbox.importVideo(source, now: now)
        try FileManager.default.removeItem(at: source)
        let owned = try inbox.file(for: record)
        XCTAssertEqual(try Data(contentsOf: owned), bytes)
        XCTAssertEqual(inbox.pending(now: now)?.fileName, record.fileName)
        XCTAssertEqual(record.originalName, "source.mp4")
        XCTAssertThrowsError(try inbox.importVideo(owned, now: now))
        XCTAssertNil(inbox.pending(now: now.addingTimeInterval(SharedVideoInbox.retention)))
        XCTAssertFalse(FileManager.default.fileExists(atPath: owned.path))
    }

    func testRejectsEmptyNonVideoAndTraversalAndClearNeverDeletesProviderFile() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let source = root.appendingPathComponent("source.mp4")
        try Data().write(to: source)
        let inbox = SharedVideoInbox(directory: root.appendingPathComponent("inbox"))
        XCTAssertThrowsError(try inbox.importVideo(source))
        XCTAssertThrowsError(try inbox.importVideo(root.appendingPathComponent("file.html")))
        XCTAssertFalse(SharedVideoInbox.validStoredName("../../source.mp4"))
        XCTAssertFalse(SharedVideoInbox.validStoredName(UUID().uuidString + ".html"))
        XCTAssertTrue(SharedVideoInbox.validStoredName(UUID().uuidString + ".mp4"))
        inbox.clear()
        XCTAssertTrue(FileManager.default.fileExists(atPath: source.path))
    }

    func testBookmarkRecoveryExpiresAndIsRemovedOnLogoutCleanup() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let source = root.appendingPathComponent("source.mp4")
        try Data([0, 1, 2]).write(to: source)
        let inbox = SharedVideoInbox(directory: root.appendingPathComponent("inbox"))
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        try inbox.remember(source, now: now)
        XCTAssertEqual(inbox.recoverySource(now: now)?.standardizedFileURL, source.standardizedFileURL)
        XCTAssertNil(inbox.recoverySource(now: now.addingTimeInterval(SharedVideoInbox.retention)))
        try inbox.remember(source, now: now)
        inbox.clear()
        XCTAssertNil(inbox.recoverySource(now: now))
        XCTAssertTrue(FileManager.default.fileExists(atPath: source.path))
    }

    func testOversizedImportLeavesNoPublishedOrPartialVideo() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let source = root.appendingPathComponent("source.mp4")
        try Data([0, 1, 2, 3]).write(to: source)
        let directory = root.appendingPathComponent("inbox")
        let inbox = SharedVideoInbox(directory: directory, byteLimit: 3)
        XCTAssertThrowsError(try inbox.importVideo(source))
        XCTAssertNil(inbox.pending())
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path), [])
    }
}
