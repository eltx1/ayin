import Foundation

enum TVAdvertisingStrategy {
    case creatorTvSSAI
    case nativeIMAClientSide
    case none

    static let browserIMAIsSupported = false
    static let nativeIMAMinimumTvOS = 15

    static func forCreatorTV(linearHLSAvailable: Bool) -> TVAdvertisingStrategy {
        linearHLSAvailable ? .creatorTvSSAI : .none
    }
}
