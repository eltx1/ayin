import XCTest
@testable import AYIN

@MainActor
final class AppRouterTests: XCTestCase {
    func testSearchOpensCanonicalWebRouteWithoutNativeSessionData() throws {
        let router = AppRouter()
        router.openDiscovery(.search, isKids: false)

        let url = try XCTUnwrap(router.webFallback)
        XCTAssertEqual(url.absoluteString, "https://ayin.stream/search")
        XCTAssertNil(url.baseURL)
        XCTAssertNil(url.query)
        XCTAssertNil(url.fragment)
        XCTAssertNil(url.user)
        XCTAssertNil(url.password)
        XCTAssertNil(router.player)
    }

    func testContinuationReturnsToExistingWebHomeInsteadOfForwardingCursor() {
        let router = AppRouter()
        router.openDiscovery(.home, isKids: false)

        XCTAssertEqual(router.webFallback?.absoluteString, "https://ayin.stream/")
        XCTAssertNil(router.player)
    }

    func testKidsDiscoveryNeverEntersGeneralWebSearchOrHome() {
        let router = AppRouter()
        let destinations: [DiscoveryWebDestination] = [.search, .home]
        for destination in destinations {
            router.openDiscovery(destination, isKids: true)
            XCTAssertEqual(router.webFallback?.absoluteString, "https://ayin.stream/kids")
            XCTAssertNil(router.webFallback?.query)
            XCTAssertNil(router.player)
        }
    }

    func testDismissingSafariAllowsAnotherDiscoveryDestination() {
        let router = AppRouter()
        router.openDiscovery(.search, isKids: false)
        router.webFallback = nil
        router.openDiscovery(.home, isKids: false)

        XCTAssertEqual(router.webFallback?.absoluteString, "https://ayin.stream/")
        XCTAssertNil(router.player)
    }

    func testUntrustedHrefsCannotReplaceWebDestination() {
        let router = AppRouter()
        router.openDiscovery(.search, isKids: false)
        let expected = router.webFallback
        for href in [
            "https://example.com/search", "//example.com/search",
            "http://ayin.stream/search", "javascript:alert(1)",
            "https://ayin.stream.example.com/search", "ayin://search"
        ] {
            router.openHref(href)
            XCTAssertEqual(router.webFallback, expected)
            XCTAssertNil(router.player)
        }
    }

    func testDiscoveryWatchLinksStillUseNativePlaybackAndKidsPolicy() {
        let router = AppRouter()
        router.openHref("/watch/example?kids=1")
        XCTAssertEqual(router.player, PlayerDestination(kind: .video, slug: "example", isKids: true))
        XCTAssertNil(router.webFallback)
    }
}
