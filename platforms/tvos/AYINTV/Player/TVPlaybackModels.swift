import Foundation

enum TVPlaybackDestination: Identifiable, Equatable {
    case video(slug: String, isKids: Bool)
    case live(slug: String)
    case creatorTV(handle: String)

    var id: String {
        switch self {
        case let .video(slug, isKids): return "video:\(slug):\(isKids)"
        case let .live(slug): return "live:\(slug)"
        case let .creatorTV(handle): return "creator-tv:\(handle)"
        }
    }
}

struct TVCaptionTrack: Decodable, Identifiable, Equatable {
    let id: String
    let objectKey: String
    let mimeType: String
    let label: String
    let language: String
    let kind: String
    let isDefault: Bool

    enum CodingKeys: String, CodingKey {
        case id, objectKey, mimeType, label, language, kind
        case isDefault = "default"
    }
}

struct TVVideoPlaybackResponse: Decodable {
    struct Video: Decodable {
        struct Source: Decodable {
            let objectKey: String
            let mimeType: String
        }
        struct Channel: Decodable {
            let id: String
            let handle: String
            let name: String
        }

        let id: String
        let slug: String
        let title: String
        let description: String?
        let durationMs: Int?
        let channel: Channel
        let source: Source
        let adaptiveSource: Source?
        let captions: [TVCaptionTrack]
    }

    let video: Video
}

struct TVPlaybackAsset: Equatable {
    let title: String
    let subtitle: String?
    let primaryURL: URL
    let fallbackURL: URL?
    let shareURL: URL
    let videoId: String?
    let channelId: String?
    let durationMs: Int?
    let isLive: Bool
    let protocolName: String
    let initialOffsetMs: Int
    let captions: [TVCaptionTrack]
    let isKids: Bool

    func mp4Fallback() -> TVPlaybackAsset? {
        guard protocolName == "HLS", let fallbackURL, !isLive else { return nil }
        return TVPlaybackAsset(
            title: title,
            subtitle: subtitle,
            primaryURL: fallbackURL,
            fallbackURL: nil,
            shareURL: shareURL,
            videoId: videoId,
            channelId: channelId,
            durationMs: durationMs,
            isLive: false,
            protocolName: "MP4",
            initialOffsetMs: initialOffsetMs,
            captions: captions,
            isKids: isKids
        )
    }
}

enum TVPlaybackCompletionAction: Equatable {
    case finalizeVOD
    case reloadCurrentDestination
    case endLive
}

enum TVPlaybackLifecycle {
    static func completionAction(for destination: TVPlaybackDestination) -> TVPlaybackCompletionAction {
        switch destination {
        case .video:
            return .finalizeVOD
        case .creatorTV:
            return .reloadCurrentDestination
        case .live:
            return .endLive
        }
    }
}

struct TVSceneResumeState: Equatable {
    private(set) var wasActive = true
    private(set) var shouldResume = false

    mutating func leaveActive(wasPlaying: Bool) -> Bool {
        guard wasActive else { return false }
        wasActive = false
        shouldResume = wasPlaying
        return true
    }

    mutating func enterActive() -> Bool {
        let resume = shouldResume
        shouldResume = false
        wasActive = true
        return resume
    }

    mutating func reset() {
        wasActive = true
        shouldResume = false
    }
}

enum TVResumePolicy {
    static func shouldApplySavedPosition(
        positionMs: Int,
        completedAt: String?,
        userNavigated: Bool
    ) -> Bool {
        completedAt == nil && positionMs > 0 && !userNavigated
    }
}
