import XCTest
@testable import AYINTV

final class TVDiscoveryModelTests: XCTestCase {
    func testDiscoveryDecodesArtworkAndContinueWatchingProgress() throws {
        let data = Data(
            """
            {
              "id": "video-id",
              "type": "VIDEO",
              "title": "Example",
              "href": "/watch/example",
              "kicker": "Creator",
              "meta": "12 min",
              "artworkObjectKey": "thumbs/example.jpg",
              "progress": {
                "positionMs": 42000,
                "completedAt": null
              }
            }
            """.utf8
        )

        let item = try JSONDecoder().decode(TVDiscoveryItem.self, from: data)
        XCTAssertEqual(item.artworkObjectKey, "thumbs/example.jpg")
        XCTAssertEqual(item.progress?.positionMs, 42_000)
        XCTAssertNil(item.progress?.completedAt)
    }

    func testDiscoveryMemberwiseInitializerKeepsOptionalDefaults() {
        let item = TVDiscoveryItem(
            id: "id",
            type: "VIDEO",
            title: "Title",
            href: "/watch/title",
            kicker: "Creator",
            meta: nil
        )
        XCTAssertNil(item.artworkObjectKey)
        XCTAssertNil(item.progress)
    }
}
