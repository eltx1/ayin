import XCTest
@testable import AYIN

final class DiscoveryModelsTests: XCTestCase {
    func testHomeDecodesExistingPageContinuationWithoutTreatingCursorAsURL() throws {
        let response = try JSONDecoder().decode(DiscoveryHomeResponse.self, from: Data("""
        {
          "rows": [{
            "key": "new-on-ayin",
            "title": "New on AYIN",
            "source": "NEW_ON_AYIN",
            "maxItems": 24,
            "items": [{
              "id": "video-1", "type": "VIDEO", "title": "Example",
              "href": "/watch/example", "kicker": "Video", "meta": null,
              "artworkObjectKey": null
            }],
            "availability": "AVAILABLE",
            "nextCursor": "opaque-page-cursor",
            "emptyMessage": "Nothing here yet."
          }]
        }
        """.utf8))

        let row = try XCTUnwrap(response.rows.first)
        XCTAssertEqual(row.items.first?.href, "/watch/example")
        XCTAssertEqual(row.nextCursor, "opaque-page-cursor")
        XCTAssertTrue(row.hasMore)
    }

    func testAbsentNullAndBlankCursorDoNotOfferContinuation() throws {
        for cursor in ["", #", "nextCursor": null"#, #", "nextCursor": """#, #", "nextCursor": "  ""#] {
            let row = try JSONDecoder().decode(DiscoveryRow.self, from: Data("""
            {"key":"empty", "title":"Empty", "items":[], "availability":"EMPTY"\(cursor)}
            """.utf8))
            XCTAssertFalse(row.hasMore)
        }
    }

    func testUnavailableRowsDecodeWithoutInventingContent() throws {
        let row = try JSONDecoder().decode(DiscoveryRow.self, from: Data("""
        {"key":"live", "title":"Live", "items":[], "availability":"UNAVAILABLE", "nextCursor":null}
        """.utf8))
        XCTAssertEqual(row.availability, "UNAVAILABLE")
        XCTAssertTrue(row.items.isEmpty)
        XCTAssertFalse(row.hasMore)
    }
}
