import Foundation

struct TVSearchResponse: Decodable {
    let query: String
    let items: [TVDiscoveryItem]
    let nextCursor: String?
    let emptyMessage: String?
}

struct TVMyAyinResponse: Decodable {
    struct Section: Decodable, Identifiable {
        let key: String
        let title: String
        let items: [TVDiscoveryItem]
        let nextCursor: String?
        let availability: String?
        let emptyMessage: String?
        var id: String { key }
    }

    let profileId: String
    let sections: [Section]
}

struct TVDiscoveryPageResponse: Decodable {
    let items: [TVDiscoveryItem]
    let nextCursor: String?
    let availability: String?
    let emptyMessage: String?
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

    struct Monetization: Decodable {
        struct DAI: Decodable {
            let available: Bool
            let playbackUrl: String?
        }

        let dai: DAI
    }

    let hls: HLS
    let monetization: Monetization?

    var preferredPlaybackURL: URL? {
        if
            let dai = monetization?.dai,
            dai.available,
            let raw = dai.playbackUrl,
            let url = URL(string: raw),
            url.scheme == "https"
        {
            return url
        }

        guard hls.available else { return nil }
        let raw = hls.masterUrl ?? hls.url
        guard let raw, let url = URL(string: raw), url.scheme == "https" else { return nil }
        return url
    }

    var usesServerSideDAI: Bool {
        guard
            let dai = monetization?.dai,
            dai.available,
            let raw = dai.playbackUrl,
            let url = URL(string: raw),
            url.scheme == "https"
        else { return false }
        return true
    }
}

struct TVPlaylistResponse: Decodable {
    struct Channel: Decodable {
        let id: String
        let handle: String
        let name: String
    }

    struct Playlist: Decodable {
        let id: String
        let slug: String
        let name: String
        let description: String?
        let visibility: String
        let systemKey: String?
    }

    struct Item: Decodable, Identifiable {
        struct Video: Decodable {
            struct Thumbnail: Decodable {
                let objectKey: String
                let mimeType: String
            }

            let id: String
            let slug: String
            let title: String
            let description: String?
            let durationMs: Int?
            let thumbnail: Thumbnail?
        }

        let id: String
        let position: Int
        let video: Video
    }

    let canonicalHandle: String
    let redirectedFrom: String?
    let channel: Channel
    let playlist: Playlist
    let items: [Item]
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
        let releaseYear: Int?
        let maturityRating: String
        let seasons: [Season]
    }

    let series: Series
}
