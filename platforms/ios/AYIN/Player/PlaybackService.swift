import Foundation

struct PlaybackService {
    private let client: APIClient

    init(client: APIClient = APIClient(baseURL: AppEnvironment.apiBaseURL)) {
        self.client = client
    }

    func load(_ destination: PlayerDestination) async throws -> NativePlayback {
        switch destination.kind {
        case .video:
            let response: VideoPlaybackResponse = try await client.request(
                "/public/videos/\(destination.slug)/playback"
            )
            let objectKey = response.video.adaptiveSource?.objectKey ?? response.video.source.objectKey
            guard let mediaURL = MediaURLBuilder.url(objectKey: objectKey) else {
                throw PlaybackError.invalidMediaURL
            }
            return NativePlayback(
                title: response.video.title,
                sourceURL: mediaURL,
                shareURL: destination.shareURL,
                isLive: false
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
                isLive: true
            )
        }
    }
}
