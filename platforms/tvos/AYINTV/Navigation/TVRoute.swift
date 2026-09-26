import Foundation

enum TVRoute: Hashable {
    case video(slug: String, isKids: Bool)
    case live(slug: String)
    case channel(handle: String)
    case creatorTV(handle: String)
    case movie(slug: String)
    case series(slug: String)

    static func parse(href: String) -> TVRoute? {
        guard let url = URL(string: href, relativeTo: AppEnvironment.webBaseURL) else { return nil }
        return parse(url: url)
    }

    static func parse(url: URL) -> TVRoute? {
        let encoded = url.absoluteString.lowercased()
        guard !encoded.contains("%2f"), !encoded.contains("%5c") else { return nil }

        let scheme = url.scheme?.lowercased()
        if scheme == "ayin-tv" {
            let host = url.host?.lowercased() ?? ""
            let parts = url.pathComponents.filter { $0 != "/" }
            guard let first = parts.first, safe(first) else { return nil }
            switch host {
            case "watch":
                return .video(slug: first, isKids: queryFlag(url, name: "kids"))
            case "live":
                return .live(slug: first)
            case "channel":
                return .channel(handle: first)
            case "tv":
                return .creatorTV(handle: first)
            default:
                return nil
            }
        }

        guard scheme == "https", url.host?.lowercased() == "ayin.stream" else { return nil }
        var parts = url.pathComponents.filter { $0 != "/" }
        if let first = parts.first, first == "en" || first == "ar" {
            parts.removeFirst()
        }

        if parts.count == 2, parts[0] == "watch", safe(parts[1]) {
            return .video(slug: parts[1], isKids: queryFlag(url, name: "kids"))
        }
        if parts.count == 2, parts[0] == "live", safe(parts[1]) {
            return .live(slug: parts[1])
        }
        if parts.count == 2, parts[0] == "movies", safe(parts[1]) {
            return .movie(slug: parts[1])
        }
        if parts.count == 2, parts[0] == "series", safe(parts[1]) {
            return .series(slug: parts[1])
        }
        if parts.count == 2, parts[0] == "c", safe(parts[1]) {
            return .channel(handle: parts[1])
        }
        if parts.count == 3, parts[0] == "c", parts[2] == "tv", safe(parts[1]) {
            return .creatorTV(handle: parts[1])
        }
        return nil
    }

    static func playerDestination(for route: TVRoute) -> TVPlaybackDestination? {
        switch route {
        case let .video(slug, isKids):
            return .video(slug: slug, isKids: isKids)
        case let .live(slug):
            return .live(slug: slug)
        case let .creatorTV(handle):
            return .creatorTV(handle: handle)
        default:
            return nil
        }
    }

    private static func queryFlag(_ url: URL, name: String) -> Bool {
        URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .contains(where: { $0.name == name && $0.value == "1" }) == true
    }

    private static func safe(_ value: String) -> Bool {
        guard !value.isEmpty, value.count <= 160 else { return false }
        return value.unicodeScalars.allSatisfy {
            CharacterSet.alphanumerics.contains($0) || "-_.".unicodeScalars.contains($0)
        }
    }
}
