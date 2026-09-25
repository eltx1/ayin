import Foundation

struct VideoPlaybackResponse: Decodable {
    struct Video: Decodable {
        struct Source: Decodable {
            let objectKey: String
            let mimeType: String
        }

        struct Channel: Decodable {
            let id: String
        }

        let id: String
        let slug: String
        let title: String
        let durationMs: Int?
        let channel: Channel
        let source: Source
        let adaptiveSource: Source?
    }

    let video: Video
}

struct LivePlaybackResponse: Decodable {
    struct Channel: Decodable {
        let id: String
    }

    let slug: String
    let title: String
    let status: String
    let playbackUrl: String?
    let channel: Channel
}

struct NativePlayback: Equatable {
    let title: String
    let sourceURL: URL
    let shareURL: URL
    let isLive: Bool
    let isKids: Bool
    let videoId: String?
    let channelId: String?
    let durationMs: Int?
    let protocolName: String
}

enum PlaybackError: LocalizedError {
    case unavailable
    case invalidMediaURL

    var errorDescription: String? {
        switch self {
        case .unavailable:
            return "This AYIN stream is not available right now."
        case .invalidMediaURL:
            return "AYIN returned an invalid media URL."
        }
    }
}

enum MediaURLBuilder {
    static func url(objectKey: String, baseURL: URL = AppEnvironment.mediaBaseURL) -> URL? {
        let segments = objectKey.split(separator: "/").map(String.init)
        guard !segments.isEmpty else { return nil }
        return segments.reduce(baseURL) { partial, segment in
            partial.appending(path: segment)
        }
    }
}
