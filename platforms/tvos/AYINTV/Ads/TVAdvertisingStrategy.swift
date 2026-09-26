import Foundation

enum TVAdvertisingStrategy {
    case creatorTvSSAI
    case nativeIMAClientSide
    case none

    static let browserIMAIsSupported = false
    static let nativeIMAMinimumTvOS = 15

    static func forCreatorTV(serverSideDAIAvailable: Bool) -> TVAdvertisingStrategy {
        serverSideDAIAvailable ? .creatorTvSSAI : .none
    }
}
