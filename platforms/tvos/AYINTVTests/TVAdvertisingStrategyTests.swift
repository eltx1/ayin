import XCTest
@testable import AYINTV

final class TVAdvertisingStrategyTests: XCTestCase {
    func testDoesNotClaimBrowserIMAOnTvOS() {
        XCTAssertFalse(TVAdvertisingStrategy.browserIMAIsSupported)
        XCTAssertEqual(TVAdvertisingStrategy.nativeIMAMinimumTvOS, 15)
    }

    func testCreatorTVUsesServerSideAdPathOnlyWhenDAIIsAvailable() {
        XCTAssertEqual(
            TVAdvertisingStrategy.forCreatorTV(serverSideDAIAvailable: true),
            .creatorTvSSAI
        )
        XCTAssertEqual(
            TVAdvertisingStrategy.forCreatorTV(serverSideDAIAvailable: false),
            .none
        )
    }
}
