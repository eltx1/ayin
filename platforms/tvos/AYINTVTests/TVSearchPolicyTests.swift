import XCTest
@testable import AYINTV

final class TVSearchPolicyTests: XCTestCase {
    func testKidsSearchUsesFilteredEndpoint() throws {
        let path = try TVCatalogService.searchPath(
            query: "cats",
            cursor: nil,
            isKids: true,
            limit: 24
        )
        XCTAssertTrue(path.hasPrefix("/public/search/kids?"))
        XCTAssertTrue(path.contains("q=cats"))
    }

    func testSearchPaginationCarriesCursor() throws {
        let path = try TVCatalogService.searchPath(
            query: "movie",
            cursor: "cursor-token",
            isKids: false,
            limit: 24
        )
        XCTAssertTrue(path.hasPrefix("/public/search?"))
        XCTAssertTrue(path.contains("cursor=cursor-token"))
    }
}
