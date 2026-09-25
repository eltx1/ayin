import Foundation

struct TVSearchResponse: Decodable {
    let query: String
    let items: [DiscoveryItem]
    let nextCursor: String?
    let emptyMessage: String?
}

struct TVMyAyinResponse: Decodable {
    struct Section: Decodable, Identifiable {
        let key: String
        let title: String
        let items: [DiscoveryItem]
        let availability: String?
        var id: String { key }
    }

    let profileId: String
    let sections: [Section]
}

struct TVChannelResponse: Decodable {
    struct Channel: Decodable {
        let id: String
        let handle: String
        let name: String
        let description: String?
    }

    struct CreatorTV: Decodable {
        let id: String
        let slug: String
        let name: String
        let status: String
    }

    struct Video: Decodable, Identifiable {
        let id: String
        let slug: String
        let title: String
        let description: String?
        let durationMs: Int?
        let thumbnail: Artwork?
    }

    struct Artwork: Decodable {
        let objectKey: String
        let mimeType: String
    }

    let canonicalHandle: String
    let channel: Channel
    let creatorTv: CreatorTV?
    let videos: [Video]
}

struct TVCreatorTVResponse: Decodable {
    struct Channel: Decodable {
        let id: String
        let handle: String
        let name: String
    }

    struct TV: Decodable {
        let id: String
        let slug: String
        let name: String
        let status: String
        let state: String
    }

    struct Schedule: Decodable {
        struct Program: Decodable, Identifiable {
            struct Video: Decodable {
                struct Source: Decodable {
                    let objectKey: String
                    let mimeType: String
                }

                let id: String
                let slug: String
                let title: String
                let description: String?
                let durationMs: Int?
                let source: Source
            }

            let occurrenceKey: String
            let video: Video
            let startsAt: String
            let endsAt: String
            let playbackOffsetMs: Int

            var id: String { occurrenceKey }
        }

        let nowPlaying: Program?
        let upNext: Program?
        let guide: [Program]
    }

    struct Playback: Decodable {
        let strategy: String
        let conceptualOffsetMs: Int
    }

    let canonicalHandle: String
    let channel: Channel
    let tv: TV
    let schedule: Schedule
    let playback: Playback
}

struct TVLinearCapabilityResponse: Decodable {
    struct HLS: Decodable {
        let available: Bool
        let url: String?
        let masterUrl: String?
    }

    let hls: HLS
}

struct TVMovieResponse: Decodable {
    struct Movie: Decodable {
        struct VideoRef: Decodable {
            let id: String
            let slug: String
            let durationMs: Int?
        }

        let id: String
        let title: String
        let slug: String
        let synopsis: String
        let releaseYear: Int
        let runtimeMinutes: Int
        let maturityRating: String
        let primaryVideo: VideoRef?
        let trailerVideo: VideoRef?
    }

    let movie: Movie?
}

struct TVSeriesResponse: Decodable {
    struct Series: Decodable {
        struct Season: Decodable, Identifiable {
            struct Episode: Decodable, Identifiable {
                struct VideoRef: Decodable {
                    let id: String
                    let slug: String
                    let title: String
                    let durationMs: Int?
                    let href: String
                }

                let id: String
                let episodeNumber: Int
                let title: String
                let synopsis: String
                let video: VideoRef
            }

            let id: String
            let seasonNumber: Int
            let title: String?
            let episodes: [Episode]
        }

        let id: String
        let title: String
        let slug: String
        let synopsis: String
        let releaseYear: Int
        let maturityRating: String
        let seasons: [Season]
    }

    let series: Series
}
