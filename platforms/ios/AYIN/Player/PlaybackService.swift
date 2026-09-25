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
                shareURL: destination.shareURL,
                isLive: false,
                isKids: destination.isKids,
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
