import XCTest
@testable import AYINTV

final class TVCatalogCapabilityTests: XCTestCase {
    func testCreatorTVPrefersServerSideDAIPlaybackURL() throws {
        let capability = TVLinearCapabilityResponse(
            hls: .init(
                available: true,
                url: "https://media.ayin.stream/linear/index.m3u8",
                masterUrl: "https://media.ayin.stream/linear/master.m3u8"
            ),
            monetization: .init(
                dai: .init(
                    available: true,
                    playbackUrl: "https://pubads.g.doubleclick.net/ssai/event/asset/stream.m3u8"
                )
            )
        )

        XCTAssertEqual(
            capability.preferredPlaybackURL?.absoluteString,
            "https://pubads.g.doubleclick.net/ssai/event/asset/stream.m3u8"
        )
        XCTAssertTrue(capability.usesServerSideDAI)
    }

    func testCreatorTVFallsBackToGenericHLSWhenDAIUnavailable() {
        let capability = TVLinearCapabilityResponse(
            hls: .init(
                available: true,
                url: "https://media.ayin.stream/linear/index.m3u8",
                masterUrl: "https://media.ayin.stream/linear/master.m3u8"
            ),
            monetization: .init(
                dai: .init(available: false, playbackUrl: nil)
            )
        )

        XCTAssertEqual(
            capability.preferredPlaybackURL?.absoluteString,
            "https://media.ayin.stream/linear/master.m3u8"
        )
        XCTAssertFalse(capability.usesServerSideDAI)
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
