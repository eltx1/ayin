import Combine
import Foundation

@MainActor
final class TVDetailViewModel: ObservableObject {
    @Published private(set) var video: TVPlaybackAsset?
    @Published private(set) var channel: TVChannelResponse?
    @Published private(set) var creatorTV: TVCreatorTVResponse?
    @Published private(set) var movie: TVMovieResponse.Movie?
    @Published private(set) var series: TVSeriesResponse.Series?
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?

    private let catalog: TVCatalogService
    private let playback: any TVPlaybackServicing

    init(
        catalog: TVCatalogService = TVCatalogService(),
        playback: any TVPlaybackServicing = TVPlaybackService()
    ) {
        self.catalog = catalog
        self.playback = playback
    }

    func load(_ route: TVRoute) async {
        isLoading = true
        errorMessage = nil
        video = nil
        channel = nil
        creatorTV = nil
        movie = nil
        series = nil
        defer { isLoading = false }

        do {
            switch route {
            case let .video(slug, isKids):
                video = try await playback.load(.video(slug: slug, isKids: isKids))
            case let .channel(handle):
                channel = try await catalog.channel(handle: handle)
            case let .creatorTV(handle):
                creatorTV = try await catalog.creatorTV(handle: handle)
            case let .movie(slug):
                movie = try await catalog.movie(slug: slug).movie
                if movie == nil { errorMessage = "This movie is not available." }
            case let .series(slug):
                series = try await catalog.series(slug: slug).series
            case .live:
                break
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
