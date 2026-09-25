import XCTest
@testable import AYINTV

final class TVRouteTests: XCTestCase {
    func testUniversalVideoLinkPreservesKidsPolicy() throws {
        let url = try XCTUnwrap(URL(string: "https://ayin.stream/watch/kids-show?kids=1"))
        XCTAssertEqual(TVRoute.parse(url: url), .video(slug: "kids-show", isKids: true))
    }

    func testLocalizedSeriesLinkRoutesNatively() throws {
        let url = try XCTUnwrap(URL(string: "https://ayin.stream/ar/series/example-series"))
        XCTAssertEqual(TVRoute.parse(url: url), .series(slug: "example-series"))
    }

    func testCreatorTVLinkRoutesNatively() throws {
        let url = try XCTUnwrap(URL(string: "https://ayin.stream/c/creator-handle/tv"))
        XCTAssertEqual(TVRoute.parse(url: url), .creatorTV(handle: "creator-handle"))
    }

    func testCustomAppleTVSchemeSupportsPlayback() throws {
        let url = try XCTUnwrap(URL(string: "ayin-tv://watch/demo-video"))
        XCTAssertEqual(TVRoute.parse(url: url), .video(slug: "demo-video", isKids: false))
    }

    func testForeignOriginAndUnsafePathsAreRejected() throws {
        XCTAssertNil(TVRoute.parse(url: try XCTUnwrap(URL(string: "https://example.com/watch/demo"))))
        XCTAssertNil(TVRoute.parse(url: try XCTUnwrap(URL(string: "ayin-tv://watch/%2Fadmin"))))
    }
}
