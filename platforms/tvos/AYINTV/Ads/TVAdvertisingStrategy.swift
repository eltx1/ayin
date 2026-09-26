import Foundation

enum TVAdvertisingConsentMode: String, Equatable {
    case personalized = "PERSONALIZED"
    case nonPersonalized = "NON_PERSONALIZED"
    case limitedAds = "LIMITED_ADS"
}

protocol TVAdvertisingConsentProviding {
    var mode: TVAdvertisingConsentMode { get }
}

struct TVSafeAdvertisingConsentProvider: TVAdvertisingConsentProviding {
    let mode: TVAdvertisingConsentMode = .limitedAds
}

struct TVLinearPlaybackSelection: Equatable {
    let url: URL
    let usesServerSideDAI: Bool
}

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

extension TVLinearCapabilityResponse {
    func playbackSelection(
        consentMode: TVAdvertisingConsentMode
    ) -> TVLinearPlaybackSelection? {
        if consentMode != .limitedAds,
           let dai = monetization?.dai,
           dai.available,
           let raw = dai.playbackUrl,
           let daiURL = URL(string: raw),
           daiURL.scheme == "https"
        {
            if consentMode == .nonPersonalized {
                var components = URLComponents(url: daiURL, resolvingAgainstBaseURL: false)
                var items = components?.queryItems ?? []
                items.removeAll { $0.name.caseInsensitiveCompare("npa") == .orderedSame }
                items.append(URLQueryItem(name: "npa", value: "1"))
                components?.queryItems = items
                if let url = components?.url {
                    return TVLinearPlaybackSelection(url: url, usesServerSideDAI: true)
                }
            } else {
                return TVLinearPlaybackSelection(url: daiURL, usesServerSideDAI: true)
            }
        }

        guard hls.available else { return nil }
        let raw = hls.masterUrl ?? hls.url
        guard let raw, let url = URL(string: raw), url.scheme == "https" else { return nil }
        return TVLinearPlaybackSelection(url: url, usesServerSideDAI: false)
    }
}
