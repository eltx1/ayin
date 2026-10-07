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

    private var playbackWebRequest: UUID?
    private var pendingPlaybackWebURL: URL?
    private var playbackWebViewerIsCurrent: (@MainActor () -> Bool)?

    func open(_ url: URL) {
        guard let link = DeepLink.parse(url) else { return }
        open(link)
    }

    func open(_ link: DeepLink) {
        if case let .web(url) = link, playbackWebRequest != nil {
            // A newer Web destination may replace the URL, but still has to wait
            // for the in-flight native stop and full-screen dismissal.
            pendingPlaybackWebURL = url
            return
        }
        cancelPlaybackWebContinuation()
        switch link {
        case let .video(slug, isKids):
            webFallback = nil
            player = PlayerDestination(kind: .video, slug: slug, isKids: isKids)
        case let .live(slug):
            webFallback = nil
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

    @discardableResult
    func openPlaybackOnWeb(
        from destination: PlayerDestination,
        shareURL: URL,
        isCurrentViewer: @escaping @MainActor () -> Bool,
        stopPlayback: @MainActor () async -> Bool
    ) async -> Bool {
        // Accept only the canonical Watch share URL from the resolved playback.
        // Its Kids flag may be stricter than the original native destination.
        guard !Task.isCancelled, isCurrentViewer(), player == destination, destination.kind == .video,
              playbackWebRequest == nil, pendingPlaybackWebURL == nil,
              let link = DeepLink.parse(shareURL), case let .video(slug, isKids) = link,
              slug == destination.slug, !destination.isKids || isKids,
              shareURL == PlayerDestination(kind: .video, slug: slug, isKids: isKids).shareURL
        else { return false }

        let request = UUID()
        playbackWebRequest = request
        playbackWebViewerIsCurrent = isCurrentViewer
        let stopped = await stopPlayback()
        guard playbackWebRequest == request else { return false }
        guard stopped, !Task.isCancelled, isCurrentViewer(), player == destination else {
            cancelPlaybackWebContinuation()
            return false
        }

        pendingPlaybackWebURL = pendingPlaybackWebURL ?? shareURL
        player = nil
        return true
    }

    func closePlayer() {
        cancelPlaybackWebContinuation()
        player = nil
    }

    func cancelPlaybackWebContinuation() {
        playbackWebRequest = nil
        pendingPlaybackWebURL = nil
        playbackWebViewerIsCurrent = nil
    }

    func playerDidDismiss() {
        let url = pendingPlaybackWebURL
        let isCurrentViewer = playbackWebViewerIsCurrent?() == true
        cancelPlaybackWebContinuation()
        // Present only after the full-screen cover has actually dismissed.
        // Bypass deep-link routing, which would open Watch in native playback again.
        guard isCurrentViewer, player == nil, webFallback == nil, let url else { return }
        webFallback = url
    }
}
