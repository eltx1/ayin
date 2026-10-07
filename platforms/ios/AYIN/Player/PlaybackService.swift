import Foundation

protocol PlaybackServicing {
    func load(_ destination: PlayerDestination, token: String?, accountId: String?,
              profileId: String?, isKids: Bool) async throws -> NativePlayback
}

struct PlaybackService: PlaybackServicing {
    private let client: APIClient

    init(client: APIClient = APIClient(baseURL: AppEnvironment.apiBaseURL)) {
        self.client = client
    }

    func load(_ destination: PlayerDestination, token: String? = nil, accountId: String? = nil,
              profileId: String? = nil, isKids: Bool = false) async throws -> NativePlayback {
        switch destination.kind {
        case .video:
            let requestedKids = destination.isKids || isKids
            var components = URLComponents()
            components.path = "/public/videos/\(destination.slug)/playback"
            var query: [URLQueryItem] = []
            if requestedKids { query.append(URLQueryItem(name: "kids", value: "1")) }
            if let profileId { query.append(URLQueryItem(name: "expectedProfileId", value: profileId)) }
            components.queryItems = query.isEmpty ? nil : query
            guard let path = components.string else { throw APIClientError.invalidURL }
            let response: VideoPlaybackResponse = try await client.request(
                path, token: token,
                headers: accountId.map { ["X-AYIN-Expected-Account": $0] } ?? [:]
            )
            let effectiveKids = requestedKids || response.viewer?.isKids == true

            guard let mp4URL = MediaURLBuilder.url(objectKey: response.video.source.objectKey) else {
                throw PlaybackError.invalidMediaURL
            }

            let adaptiveURL = response.video.adaptiveSource.flatMap {
                MediaURLBuilder.url(objectKey: $0.objectKey)
            }
            if response.video.adaptiveSource != nil, adaptiveURL == nil {
                throw PlaybackError.invalidMediaURL
            }

            return NativePlayback(
                title: response.video.title,
                sourceURL: adaptiveURL ?? mp4URL,
                fallbackSourceURL: adaptiveURL == nil ? nil : mp4URL,
                shareURL: PlayerDestination(kind: .video, slug: destination.slug, isKids: effectiveKids).shareURL,
                isLive: false,
                isKids: effectiveKids,
                videoId: response.video.id,
                channelId: response.video.channel.id,
                durationMs: response.video.durationMs,
                protocolName: adaptiveURL == nil ? "MP4" : "HLS"
            )

        case .live:
            let response: LivePlaybackResponse = try await client.request(
                "/live/\(destination.slug)"
            )
            guard
                response.status == "LIVE",
                let raw = response.playbackUrl,
                let mediaURL = URL(string: raw),
                mediaURL.scheme == "https"
            else {
                throw PlaybackError.unavailable
            }
            return NativePlayback(
                title: response.title,
                sourceURL: mediaURL,
                fallbackSourceURL: nil,
                shareURL: destination.shareURL,
                isLive: true,
                isKids: false,
                videoId: nil,
                channelId: response.channel.id,
                durationMs: nil,
                protocolName: "HLS"
            )
        }
    }
}
