import Combine
import Foundation

@MainActor
final class TVDetailViewModel: ObservableObject {
    @Published private(set) var video: TVPlaybackAsset?
    @Published private(set) var channel: TVChannelResponse?
    @Published private(set) var creatorTV: TVCreatorTVResponse?
    @Published private(set) var playlist: TVPlaylistResponse?
    @Published private(set) var movie: TVMovieResponse.Movie?
    @Published private(set) var series: TVSeriesResponse.Series?
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?

    private let catalog: TVCatalogService
    private let playback: any TVPlaybackServicing
    private var loadGeneration: UInt64 = 0
    private var token: String?
    private var accountId: String?
    private var profileId: String?
    private var viewerIsKids = false

    init(
        catalog: TVCatalogService = TVCatalogService(),
        playback: any TVPlaybackServicing = TVPlaybackService()
    ) {
        self.catalog = catalog
        self.playback = playback
    }

    func viewerDidChange(token: String?, accountId: String?, profileId: String?, isKids: Bool) {
        guard self.token != token || self.accountId != accountId || self.profileId != profileId ||
                viewerIsKids != isKids else { return }
        invalidateViewer()
    }

    func invalidateViewer() {
        loadGeneration &+= 1
        isLoading = false
        errorMessage = nil
        video = nil
        channel = nil
        creatorTV = nil
        playlist = nil
        movie = nil
        series = nil
    }

    func load(_ route: TVRoute, token: String? = nil, accountId: String? = nil,
              profileId: String? = nil, isKids: Bool = false) async {
        guard !Task.isCancelled else { return }
        invalidateViewer()
        let generation = loadGeneration
        self.token = token
        self.accountId = accountId
        self.profileId = profileId
        viewerIsKids = isKids
        isLoading = true
        defer { if loadGeneration == generation { isLoading = false } }

        do {
            switch route {
            case let .video(slug, routeIsKids):
                let loaded = try await playback.load(.video(slug: slug, isKids: routeIsKids), token: token,
                                                     accountId: accountId, profileId: profileId, isKids: isKids)
                guard !Task.isCancelled, loadGeneration == generation else { return }
                video = loaded
            case let .channel(handle):
                let loaded = try await catalog.channel(handle: handle)
                guard !Task.isCancelled, loadGeneration == generation else { return }
                channel = loaded
            case let .creatorTV(handle):
                let loaded = try await catalog.creatorTV(handle: handle)
                guard !Task.isCancelled, loadGeneration == generation else { return }
                creatorTV = loaded
            case let .playlist(handle, slug):
                let loaded = try await catalog.playlist(handle: handle, slug: slug)
                guard !Task.isCancelled, loadGeneration == generation else { return }
                playlist = loaded
            case let .movie(slug):
                let loaded = try await catalog.movie(slug: slug).movie
                guard !Task.isCancelled, loadGeneration == generation else { return }
                movie = loaded
                if movie == nil { errorMessage = "This movie is not available." }
            case let .series(slug):
                let loaded = try await catalog.series(slug: slug).series
                guard !Task.isCancelled, loadGeneration == generation else { return }
                series = loaded
            case .live:
                break
            }
        } catch {
            guard !Task.isCancelled, loadGeneration == generation else { return }
            errorMessage = error.localizedDescription
        }
    }
}
