import XCTest
@testable import AYINTV

final class TVAdvertisingStrategyTests: XCTestCase {
    func testDoesNotClaimBrowserIMAOnTvOS() {
        XCTAssertFalse(TVAdvertisingStrategy.browserIMAIsSupported)
        XCTAssertEqual(TVAdvertisingStrategy.nativeIMAMinimumTvOS, 15)
    }

    func testSafeConsentProviderDefaultsToLimitedAds() {
        XCTAssertEqual(TVSafeAdvertisingConsentProvider().mode, .limitedAds)
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
