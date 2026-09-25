import Combine
import Foundation

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
        case let .video(slug):
            player = PlayerDestination(kind: .video, slug: slug)
        case let .live(slug):
            player = PlayerDestination(kind: .live, slug: slug)
        case let .web(url):
            webFallback = url
        }
    }

    func openHref(_ href: String) {
        guard let url = URL(string: href, relativeTo: AppEnvironment.webBaseURL) else { return }
        open(url)
    }
}
