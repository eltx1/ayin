import Combine
import Foundation

@MainActor
final class TVRouter: ObservableObject {
    @Published var path: [TVRoute] = []
    @Published var player: TVPlaybackDestination?

    func open(href: String) {
        guard let route = TVRoute.parse(href: href) else { return }
        open(route)
    }

    func open(url: URL) {
        guard let route = TVRoute.parse(url: url) else { return }
        open(route)
    }

    func open(_ route: TVRoute) {
        switch route {
        case let .live(slug):
            player = .live(slug: slug)
        default:
            path.append(route)
        }
    }

    func play(_ destination: TVPlaybackDestination) {
        player = destination
    }
}
