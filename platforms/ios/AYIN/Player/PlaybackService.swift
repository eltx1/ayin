import Foundation

protocol PlaybackServicing {
    func load(_ destination: PlayerDestination) async throws -> NativePlayback
}

struct PlaybackService: PlaybackServicing {
    private let client: APIClient

    init(client: APIClient = APIClient(baseURL: AppEnvironment.apiBaseURL)) {
        self.client = client
    }

    func load(_ destination: PlayerDestination) async throws -> NativePlayback {
        switch destination.kind {
        case .video:
            let kidsQuery = destination.isKids ? "?kids=1" : ""
            let response: VideoPlaybackResponse = try await client.request(
                "/public/videos/\(destination.slug)/playback\(kidsQuery)"
            )
            let adaptive = response.video.adaptiveSource
            let source = adaptive ?? response.video.source
            guard let mediaURL = MediaURLBuilder.url(objectKey: source.objectKey) else {
                throw PlaybackError.invalidMediaURL
            }
            return NativePlayback(
                title: response.video.title,
                sourceURL: mediaURL,
                shareURL: destination.shareURL,
                isLive: false,
                isKids: destination.isKids,
                videoId: response.video.id,
                channelId: response.video.channel.id,
                durationMs: response.video.durationMs,
                protocolName: adaptive == nil ? "MP4" : "HLS"
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
