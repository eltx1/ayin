import Foundation

protocol TVPlaybackServicing {
    func load(_ destination: TVPlaybackDestination, token: String?, accountId: String?,
              profileId: String?, isKids: Bool) async throws -> TVPlaybackAsset
}

struct TVPlaybackService: TVPlaybackServicing {
    private let client: APIClient
    private let catalog: TVCatalogService
    private let advertisingConsent: any TVAdvertisingConsentProviding

    init(
        client: APIClient = APIClient(baseURL: AppEnvironment.apiBaseURL),
        catalog: TVCatalogService = TVCatalogService(),
        advertisingConsent: any TVAdvertisingConsentProviding = TVSafeAdvertisingConsentProvider()
    ) {
        self.client = client
        self.catalog = catalog
        self.advertisingConsent = advertisingConsent
    }

    func load(_ destination: TVPlaybackDestination, token: String? = nil, accountId: String? = nil,
              profileId: String? = nil, isKids: Bool = false) async throws -> TVPlaybackAsset {
        switch destination {
        case let .video(slug, routeIsKids):
            return try await video(slug: slug, isKids: routeIsKids || isKids,
                                   token: token, accountId: accountId, profileId: profileId)
        case let .live(slug):
            return try await live(slug: slug)
        case let .creatorTV(handle):
            return try await creatorTV(handle: handle)
        }
    }

    private func video(slug: String, isKids: Bool, token: String?, accountId: String?,
                       profileId: String?) async throws -> TVPlaybackAsset {
        var components = URLComponents()
        components.path = "/public/videos/\(slug)/playback"
        var query: [URLQueryItem] = []
        if isKids { query.append(URLQueryItem(name: "kids", value: "1")) }
        if let profileId { query.append(URLQueryItem(name: "expectedProfileId", value: profileId)) }
        components.queryItems = query.isEmpty ? nil : query
        guard let path = components.string else { throw APIClientError.invalidURL }
        let response: TVVideoPlaybackResponse = try await client.request(
            path, token: token,
            headers: accountId.map { ["X-AYIN-Expected-Account": $0] } ?? [:]
        )
        let effectiveKids = isKids || response.viewer?.isKids == true
        guard let mp4 = MediaURLBuilder.url(objectKey: response.video.source.objectKey) else {
            throw PlaybackError.invalidMediaURL
        }
        let hls = response.video.adaptiveSource.flatMap {
            MediaURLBuilder.url(objectKey: $0.objectKey)
        }
        if response.video.adaptiveSource != nil, hls == nil {
            throw PlaybackError.invalidMediaURL
        }

        var share = AppEnvironment.webBaseURL.appending(path: "watch").appending(path: slug)
        if effectiveKids {
            var components = URLComponents(url: share, resolvingAgainstBaseURL: false)
            components?.queryItems = [URLQueryItem(name: "kids", value: "1")]
            share = components?.url ?? share
        }

        return TVPlaybackAsset(
            title: response.video.title,
            subtitle: response.video.channel.name,
            primaryURL: hls ?? mp4,
            fallbackURL: hls == nil ? nil : mp4,
            shareURL: share,
            videoId: response.video.id,
            channelId: response.video.channel.id,
            durationMs: response.video.durationMs,
            isLive: false,
            protocolName: hls == nil ? "MP4" : "HLS",
            initialOffsetMs: 0,
            captions: response.video.captions,
            isKids: effectiveKids
        )
    }

    private func live(slug: String) async throws -> TVPlaybackAsset {
        let response: LivePlaybackResponse = try await client.request("/live/\(slug)")
        guard
            response.status == "LIVE",
            let raw = response.playbackUrl,
            let url = URL(string: raw),
            url.scheme == "https"
        else {
            throw PlaybackError.unavailable
        }
        return TVPlaybackAsset(
            title: response.title,
            subtitle: "Live",
            primaryURL: url,
            fallbackURL: nil,
            shareURL: AppEnvironment.webBaseURL.appending(path: "live").appending(path: slug),
            videoId: nil,
            channelId: response.channel.id,
            durationMs: nil,
            isLive: true,
            protocolName: "HLS",
            initialOffsetMs: 0,
            captions: [],
            isKids: false
        )
    }

    private func creatorTV(handle: String) async throws -> TVPlaybackAsset {
        async let tvRequest = catalog.creatorTV(handle: handle)
        async let linearRequest = try? catalog.creatorTVLinear(handle: handle)
        let tv = try await tvRequest
        let linear = await linearRequest

        if let linear,
           let selection = linear.playbackSelection(consentMode: advertisingConsent.mode)
        {
            return TVPlaybackAsset(
                title: tv.tv.name,
                subtitle: tv.channel.name,
                primaryURL: selection.url,
                fallbackURL: nil,
                shareURL: AppEnvironment.webBaseURL
                    .appending(path: "c")
                    .appending(path: handle)
                    .appending(path: "tv"),
                videoId: tv.schedule.nowPlaying?.video.id,
                channelId: tv.channel.id,
                durationMs: nil,
                isLive: true,
                protocolName: selection.usesServerSideDAI ? "HLS-DAI" : "HLS",
                initialOffsetMs: 0,
                captions: [],
                isKids: false
            )
        }

        guard
            let nowPlaying = tv.schedule.nowPlaying,
            let url = MediaURLBuilder.url(objectKey: nowPlaying.video.source.objectKey)
        else {
            throw PlaybackError.unavailable
        }

        return TVPlaybackAsset(
            title: nowPlaying.video.title,
            subtitle: "\(tv.tv.name) · \(tv.channel.name)",
            primaryURL: url,
            fallbackURL: nil,
            shareURL: AppEnvironment.webBaseURL
                .appending(path: "c")
                .appending(path: handle)
                .appending(path: "tv"),
            videoId: nowPlaying.video.id,
            channelId: tv.channel.id,
            durationMs: nowPlaying.video.durationMs,
            isLive: true,
            protocolName: "MP4",
            initialOffsetMs: max(0, tv.playback.conceptualOffsetMs),
            captions: [],
            isKids: false
        )
    }
}
