import XCTest
@testable import AYIN

final class DeepLinkTests: XCTestCase {
    func testUniversalVideoLink() throws {
        let link = DeepLink.parse(try XCTUnwrap(URL(string: "https://ayin.stream/watch/demo-video")))
        XCTAssertEqual(link, .video(slug: "demo-video", isKids: false))
    }

    func testLocalizedUniversalVideoLink() throws {
        let link = DeepLink.parse(try XCTUnwrap(URL(string: "https://ayin.stream/ar/watch/demo-video")))
        XCTAssertEqual(link, .video(slug: "demo-video", isKids: false))
    }

    func testKidsVideoLinkPreservesServerPolicyContext() throws {
        let link = DeepLink.parse(
            try XCTUnwrap(URL(string: "https://ayin.stream/watch/kids-show?kids=1"))
        )
        XCTAssertEqual(link, .video(slug: "kids-show", isKids: true))
    }

    func testKidsShareURLPreservesKidsPolicyContext() throws {
        let destination = PlayerDestination(kind: .video, slug: "kids-show", isKids: true)
        let components = try XCTUnwrap(
            URLComponents(url: destination.shareURL, resolvingAgainstBaseURL: false)
        )
        XCTAssertEqual(components.path, "/watch/kids-show")
        XCTAssertEqual(components.queryItems?.first(where: { $0.name == "kids" })?.value, "1")
        XCTAssertEqual(DeepLink.parse(destination.shareURL), .video(slug: "kids-show", isKids: true))
    }

    func testCustomLiveLink() throws {
        let link = DeepLink.parse(try XCTUnwrap(URL(string: "ayin://live/main-stage")))
        XCTAssertEqual(link, .live(slug: "main-stage"))
    }

    func testForeignHostIsRejected() throws {
        let link = DeepLink.parse(try XCTUnwrap(URL(string: "https://example.com/watch/demo-video")))
        XCTAssertNil(link)
    }

    func testMalformedSlugIsRejected() throws {
        let link = DeepLink.parse(try XCTUnwrap(URL(string: "ayin://watch/%2Fadmin")))
        XCTAssertNil(link)
    }

    func testOtherAyinPagesRemainSafeWebFallbacks() throws {
        let url = try XCTUnwrap(URL(string: "https://ayin.stream/movies/example"))
        XCTAssertEqual(DeepLink.parse(url), .web(url))
    }
}
