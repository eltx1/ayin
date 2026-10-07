import Combine
import Foundation

enum DiscoveryWebDestination {
    case search
    case home

    func href(isKids: Bool) -> String {
        // Safari verifies its own session. A native Kids profile must enter
        // the explicitly filtered Kids catalog, not general Web Search/Home.
        if isKids { return "/kids" }
        switch self {
        case .search: return "/search"
        case .home: return "/"
        }
    }
}

@MainActor
final class AppRouter: ObservableObject {
    @Published var player: PlayerDestination?
    @Published var webFallback: URL?

    func open(_ url: URL) {
        guard let link = DeepLink.parse(url) else { return }
        open(link)
    }

    func open(_ link: DeepLink) {
        switch link {
        case let .video(slug, isKids):
            player = PlayerDestination(kind: .video, slug: slug, isKids: isKids)
        case let .live(slug):
            player = PlayerDestination(kind: .live, slug: slug)
        case let .web(url):
            webFallback = url
        }
    }

    func openHref(_ href: String) {
        guard let url = URL(string: href, relativeTo: AppEnvironment.webBaseURL) else { return }
        open(url.absoluteURL)
    }

    func openDiscovery(_ destination: DiscoveryWebDestination, isKids: Bool) {
        // Only route constants cross into Safari: never bearer tokens, profile
        // identifiers, or cursors from the independently authenticated feed.
        openHref(destination.href(isKids: isKids))
    }
}
