import XCTest
@testable import AYINTV

final class TVAdvertisingStrategyTests: XCTestCase {
    func testDoesNotClaimBrowserIMAOnTvOS() {
        XCTAssertFalse(TVAdvertisingStrategy.browserIMAIsSupported)
        XCTAssertEqual(TVAdvertisingStrategy.nativeIMAMinimumTvOS, 15)
    }

    func testCreatorTVUsesServerSideAdPathOnlyWhenLinearHLSIsAvailable() {
        XCTAssertEqual(
            TVAdvertisingStrategy.forCreatorTV(linearHLSAvailable: true),
            .creatorTvSSAI
        )
        XCTAssertEqual(
            TVAdvertisingStrategy.forCreatorTV(linearHLSAvailable: false),
            .none
        )
    }
}
