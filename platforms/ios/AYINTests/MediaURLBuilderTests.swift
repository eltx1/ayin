import XCTest
@testable import AYIN

final class MediaURLBuilderTests: XCTestCase {
    func testMediaObjectKeyBuildsUnderCanonicalMediaOrigin() throws {
        let base = try XCTUnwrap(URL(string: "https://media.ayin.stream"))
        let url = try XCTUnwrap(MediaURLBuilder.url(objectKey: "videos/a file/master.m3u8", baseURL: base))
        XCTAssertEqual(url.scheme, "https")
        XCTAssertEqual(url.host, "media.ayin.stream")
        XCTAssertEqual(url.path, "/videos/a file/master.m3u8")
        XCTAssertTrue(url.absoluteString.contains("a%20file"))
    }

    func testEmptyObjectKeyIsRejected() {
        XCTAssertNil(MediaURLBuilder.url(objectKey: ""))
    }
}
