import XCTest
@testable import AYINTV

final class TVCatalogCapabilityTests: XCTestCase {
    private func capability(
        daiAvailable: Bool = true,
        playbackUrl: String? = "https://pubads.g.doubleclick.net/ssai/event/asset/stream.m3u8"
    ) -> TVLinearCapabilityResponse {
        TVLinearCapabilityResponse(
            hls: .init(
                available: true,
                url: "https://media.ayin.stream/linear/index.m3u8",
                masterUrl: "https://media.ayin.stream/linear/master.m3u8"
            ),
            monetization: .init(
                dai: .init(
                    available: daiAvailable,
                    playbackUrl: playbackUrl
                )
            )
        )
    }

    func testPersonalizedConsentMayUseServerSideDAI() throws {
        let selection = try XCTUnwrap(
            capability().playbackSelection(consentMode: .personalized)
        )
        XCTAssertEqual(
            selection.url.absoluteString,
            "https://pubads.g.doubleclick.net/ssai/event/asset/stream.m3u8"
        )
        XCTAssertTrue(selection.usesServerSideDAI)
    }

    func testNonPersonalizedConsentAddsNpaToDAI() throws {
        let selection = try XCTUnwrap(
            capability(
                playbackUrl: "https://pubads.g.doubleclick.net/ssai/event/asset/stream.m3u8?foo=bar"
            ).playbackSelection(consentMode: .nonPersonalized)
        )
        let components = try XCTUnwrap(
            URLComponents(url: selection.url, resolvingAgainstBaseURL: false)
        )
        XCTAssertEqual(components.queryItems?.first(where: { $0.name == "foo" })?.value, "bar")
        XCTAssertEqual(components.queryItems?.first(where: { $0.name == "npa" })?.value, "1")
        XCTAssertTrue(selection.usesServerSideDAI)
    }

    func testLimitedAdsConsentUsesGenericHLSInsteadOfDAI() throws {
        let selection = try XCTUnwrap(
            capability().playbackSelection(consentMode: .limitedAds)
        )
        XCTAssertEqual(
            selection.url.absoluteString,
            "https://media.ayin.stream/linear/master.m3u8"
        )
        XCTAssertFalse(selection.usesServerSideDAI)
    }

    func testCreatorTVFallsBackToGenericHLSWhenDAIUnavailable() throws {
        let selection = try XCTUnwrap(
            capability(daiAvailable: false, playbackUrl: nil)
                .playbackSelection(consentMode: .personalized)
        )
        XCTAssertEqual(
            selection.url.absoluteString,
            "https://media.ayin.stream/linear/master.m3u8"
        )
        XCTAssertFalse(selection.usesServerSideDAI)
    }

    func testSeriesDetailAcceptsMissingReleaseYear() throws {
        let data = Data(
            """
            {
              "series": {
                "id": "series-id",
                "title": "Undated Series",
                "slug": "undated-series",
                "synopsis": "A published series without a release year.",
                "releaseYear": null,
                "maturityRating": "TV-PG",
                "seasons": []
              }
            }
            """.utf8
        )

        let decoded = try JSONDecoder().decode(TVSeriesResponse.self, from: data)
        XCTAssertNil(decoded.series.releaseYear)
    }

    func testPlaybackCompletionPolicyMatchesSurface() {
        XCTAssertEqual(
            TVPlaybackLifecycle.completionAction(
                for: .video(slug: "video", isKids: false)
            ),
            .finalizeVOD
        )
        XCTAssertEqual(
            TVPlaybackLifecycle.completionAction(
                for: .creatorTV(handle: "creator")
            ),
            .reloadCurrentDestination
        )
        XCTAssertEqual(
            TVPlaybackLifecycle.completionAction(
                for: .live(slug: "live")
            ),
            .endLive
        )
    }
}
