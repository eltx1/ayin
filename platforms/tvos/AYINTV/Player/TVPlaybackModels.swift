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

struct TVPlaybackChapter: Decodable, Identifiable, Equatable {
    let id: String
    let title: String
    let startMs: Int

    static func available(_ chapters: [TVPlaybackChapter], durationMs: Int?) -> [TVPlaybackChapter] {
        var previousStart = -1
        var identifiers = Set<String>()
        return chapters.prefix(100).filter { chapter in
            guard !chapter.id.isEmpty, !chapter.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  chapter.startMs >= 0, chapter.startMs > previousStart,
                  durationMs.map({ chapter.startMs < $0 }) ?? true,
                  identifiers.insert(chapter.id).inserted else { return false }
            previousStart = chapter.startMs
            return true
        }
    }
}

struct TVPlaybackEpisode: Decodable, Equatable {
    struct Video: Decodable, Equatable {
        let id: String
        let slug: String
        let href: String
    }

    let title: String
    let episodeNumber: Int
    let seasonNumber: Int?
    let video: Video
}

struct TVPlaybackSeriesContext: Decodable, Equatable {
    struct Series: Decodable, Equatable {
        let title: String
        let slug: String
        let href: String
    }

    let series: Series
    let episode: TVPlaybackEpisode
}

struct TVVideoPlaybackResponse: Decodable {
    struct Detail: Decodable {
        let contentType: String
        let seriesContext: TVPlaybackSeriesContext?
        let nextEpisode: TVPlaybackEpisode?
    }

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
        let chapters: [TVPlaybackChapter]?
    }

    let video: Video
    let viewer: PlaybackViewerPolicy?
    let detail: Detail?
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
    var chapters: [TVPlaybackChapter] = []
    var seriesContext: TVPlaybackSeriesContext? = nil
    var nextEpisode: TVPlaybackEpisode? = nil

    var nextEpisodeDestination: TVPlaybackDestination? {
        guard !isLive, !isKids, let seriesContext, let nextEpisode,
              seriesContext.episode.video.id == videoId,
              nextEpisode.video.id != videoId,
              let route = TVRoute.parse(href: nextEpisode.video.href),
              case let .video(slug, isKids) = route,
              slug == nextEpisode.video.slug,
              slug != seriesContext.episode.video.slug else { return nil }
        return .video(slug: slug, isKids: isKids)
    }

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
            isKids: isKids,
            chapters: chapters,
            seriesContext: seriesContext,
            nextEpisode: nextEpisode
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

    mutating func leaveActive(shouldResumePlayback: Bool) -> Bool {
        guard wasActive else { return false }
        wasActive = false
        shouldResume = shouldResumePlayback
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

enum TVPlaybackScenePolicy {
    static func shouldPause(
        sceneIsActive: Bool,
        pictureInPictureActive: Bool
    ) -> Bool {
        !sceneIsActive && !pictureInPictureActive
    }
}

enum TVProgressPersistence {
    static func shouldSave(
        lastSavedPositionMs: Int?,
        currentPositionMs: Int,
        force: Bool
    ) -> Bool {
        force ||
            lastSavedPositionMs == nil ||
            abs(currentPositionMs - (lastSavedPositionMs ?? 0)) >= 5_000
    }
}
