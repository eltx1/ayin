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

    func testPlaybackContinuationWaitsForStopAndCoverDismissalAndPreservesEffectiveKids() async throws {
        let router = AppRouter()
        let destination = PlayerDestination(kind: .video, slug: "example")
        let shareURL = PlayerDestination(kind: .video, slug: "example", isKids: true).shareURL
        router.openHref("/watch/example")
        let stop = HeldPlaybackStop()
        let transition = Task {
            await router.openPlaybackOnWeb(from: destination, shareURL: shareURL, isCurrentViewer: { true }, stopPlayback: stop.stop)
        }
        await fulfillment(of: [stop.started], timeout: 2)

        XCTAssertEqual(router.player, destination)
        XCTAssertNil(router.webFallback, "Safari must not compete with native playback or its cover")
        stop.finish()
        let didDismiss = await transition.value
        XCTAssertTrue(didDismiss)
        XCTAssertNil(router.player)
        XCTAssertNil(router.webFallback, "Setting the cover binding is not its dismissal completion")

        router.playerDidDismiss()
        let url = try XCTUnwrap(router.webFallback)
        XCTAssertEqual(url.absoluteString, "https://ayin.stream/watch/example?kids=1")
        XCTAssertNil(url.user)
        XCTAssertNil(url.password)
        XCTAssertNil(url.fragment)
        XCTAssertEqual(stop.calls, 1)

        router.webFallback = nil
        router.playerDidDismiss()
        XCTAssertNil(router.webFallback, "Dismissal callbacks must not reopen a consumed continuation")
        XCTAssertNil(router.player, "Closing Safari must not revive native media")
    }

    func testRepeatedPlaybackContinuationDoesNotDuplicateStopOrReopenSafari() async {
        let router = AppRouter()
        let destination = PlayerDestination(kind: .video, slug: "example")
        router.openHref("/watch/example")
        let stop = HeldPlaybackStop()
        let transition = Task {
            await router.openPlaybackOnWeb(from: destination, shareURL: destination.shareURL, isCurrentViewer: { true }, stopPlayback: stop.stop)
        }
        await fulfillment(of: [stop.started], timeout: 2)
        let repeated = await router.openPlaybackOnWeb(
            from: destination, shareURL: destination.shareURL, isCurrentViewer: { true }, stopPlayback: stop.stop
        )
        XCTAssertFalse(repeated)
        XCTAssertEqual(stop.calls, 1)
        stop.finish()
        _ = await transition.value
        router.playerDidDismiss()
        router.webFallback = nil

        router.openHref("/watch/example")
        var freshStops = 0
        let reopened = await router.openPlaybackOnWeb(from: destination, shareURL: destination.shareURL, isCurrentViewer: { true }) {
            freshStops += 1
            return true
        }
        XCTAssertTrue(reopened)
        router.playerDidDismiss()
        XCTAssertEqual(freshStops, 1)
        XCTAssertEqual(router.webFallback, destination.shareURL)
    }

    func testClosingPlayerWhileStopIsHeldCancelsWebContinuation() async {
        let router = AppRouter()
        let destination = PlayerDestination(kind: .video, slug: "example")
        router.openHref("/watch/example")
        let stop = HeldPlaybackStop()
        let transition = Task {
            await router.openPlaybackOnWeb(from: destination, shareURL: destination.shareURL, isCurrentViewer: { true }, stopPlayback: stop.stop)
        }
        await fulfillment(of: [stop.started], timeout: 2)
        router.closePlayer()
        router.playerDidDismiss()
        stop.finish()
        let didDismiss = await transition.value
        XCTAssertFalse(didDismiss)
        router.playerDidDismiss()
        XCTAssertNil(router.player)
        XCTAssertNil(router.webFallback)
    }

    func testCanceledTaskCannotOpenWebAfterHeldStopReturns() async {
        let router = AppRouter()
        let destination = PlayerDestination(kind: .video, slug: "example")
        router.openHref("/watch/example")
        let stop = HeldPlaybackStop()
        let transition = Task {
            await router.openPlaybackOnWeb(from: destination, shareURL: destination.shareURL, isCurrentViewer: { true }, stopPlayback: stop.stop)
        }
        await fulfillment(of: [stop.started], timeout: 2)
        transition.cancel()
        stop.finish()
        let didDismiss = await transition.value
        XCTAssertFalse(didDismiss)
        XCTAssertEqual(router.player, destination)
        XCTAssertNil(router.webFallback)
    }

    func testViewerChangeDuringCoverDismissalDiscardsPendingWebURL() async {
        let router = AppRouter()
        let destination = PlayerDestination(kind: .video, slug: "example")
        router.openHref("/watch/example")
        var isCurrentViewer = true
        let didDismiss = await router.openPlaybackOnWeb(
            from: destination, shareURL: destination.shareURL, isCurrentViewer: { isCurrentViewer }
        ) { true }
        XCTAssertTrue(didDismiss)

        // Check again at dismissal even if PlayerScreen no longer receives session publications.
        isCurrentViewer = false
        router.playerDidDismiss()
        XCTAssertNil(router.player)
        XCTAssertNil(router.webFallback)
    }

    func testNewRequestForSameVideoSurvivesOldHeldStopCompletion() async {
        let router = AppRouter()
        let destination = PlayerDestination(kind: .video, slug: "example")
        router.openHref("/watch/example")
        let oldStop = HeldPlaybackStop()
        let oldTransition = Task {
            await router.openPlaybackOnWeb(from: destination, shareURL: destination.shareURL, isCurrentViewer: { true }, stopPlayback: oldStop.stop)
        }
        await fulfillment(of: [oldStop.started], timeout: 2)

        router.openHref("/watch/example")
        let currentStop = HeldPlaybackStop()
        let currentTransition = Task {
            await router.openPlaybackOnWeb(from: destination, shareURL: destination.shareURL, isCurrentViewer: { true }, stopPlayback: currentStop.stop)
        }
        await fulfillment(of: [currentStop.started], timeout: 2)
        oldStop.finish()
        let oldDismissed = await oldTransition.value
        XCTAssertFalse(oldDismissed)
        XCTAssertEqual(router.player, destination)
        XCTAssertNil(router.webFallback)

        currentStop.finish()
        let currentDismissed = await currentTransition.value
        XCTAssertTrue(currentDismissed)
        router.playerDidDismiss()
        XCTAssertEqual(router.webFallback, destination.shareURL)
    }

    func testNewWebNavigationWinsOverHeldPlaybackContinuation() async {
        let router = AppRouter()
        let destination = PlayerDestination(kind: .video, slug: "example")
        router.openHref("/watch/example")
        let stop = HeldPlaybackStop()
        let transition = Task {
            await router.openPlaybackOnWeb(from: destination, shareURL: destination.shareURL, isCurrentViewer: { true }, stopPlayback: stop.stop)
        }
        await fulfillment(of: [stop.started], timeout: 2)
        router.openDiscovery(.search, isKids: true)
        XCTAssertNil(router.webFallback)
        XCTAssertEqual(router.player, destination)
        stop.finish()
        _ = await transition.value
        XCTAssertNil(router.webFallback)
        router.playerDidDismiss()
        XCTAssertEqual(router.webFallback?.absoluteString, "https://ayin.stream/kids")
    }

    func testFailedStopLeavesNativeDestinationAndDoesNotOpenWeb() async {
        let router = AppRouter()
        let destination = PlayerDestination(kind: .video, slug: "example")
        router.openHref("/watch/example")
        let didDismiss = await router.openPlaybackOnWeb(from: destination, shareURL: destination.shareURL, isCurrentViewer: { true }) { false }
        XCTAssertFalse(didDismiss)
        XCTAssertEqual(router.player, destination)
        router.playerDidDismiss()
        XCTAssertNil(router.webFallback)
    }

    func testPlaybackContinuationRejectsNoncanonicalURLsAndKidsDowngradeBeforeStopping() async throws {
        let router = AppRouter()
        let destination = PlayerDestination(kind: .video, slug: "example", isKids: true)
        router.openHref("/watch/example?kids=1")
        var stops = 0
        for raw in [
            "https://ayin.stream/watch/example",
            "https://ayin.stream/watch/other?kids=1",
            "https://ayin.stream/watch/example?kids=1&token=secret",
            "https://ayin.stream/watch/example?kids=1&profileId=profile",
            "https://ayin.stream/watch/example?kids=1#fragment",
            "https://user:password@ayin.stream/watch/example?kids=1",
            "https://ayin.stream:444/watch/example?kids=1",
            "https://example.com/watch/example?kids=1",
            "ayin://watch/example?kids=1",
            "http://ayin.stream/watch/example?kids=1"
        ] {
            let url = try XCTUnwrap(URL(string: raw))
            let didDismiss = await router.openPlaybackOnWeb(from: destination, shareURL: url, isCurrentViewer: { true }) {
                stops += 1
                return true
            }
            XCTAssertFalse(didDismiss, raw)
        }
        XCTAssertEqual(stops, 0)
        XCTAssertEqual(router.player, destination)
        XCTAssertNil(router.webFallback)
    }
}

@MainActor
private final class HeldPlaybackStop {
    let started = XCTestExpectation(description: "Native stop is held")
    private(set) var calls = 0
    private var continuation: CheckedContinuation<Bool, Never>?

    func stop() async -> Bool {
        calls += 1
        return await withCheckedContinuation {
            continuation = $0
            started.fulfill()
        }
    }

    func finish() {
        continuation?.resume(returning: true)
        continuation = nil
    }
}
