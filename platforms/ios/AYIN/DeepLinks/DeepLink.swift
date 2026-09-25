import Foundation

enum DeepLink: Equatable {
    case video(slug: String, isKids: Bool)
    case live(slug: String)
    case web(URL)

    static func parse(_ url: URL) -> DeepLink? {
        let isKids = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .contains(where: { $0.name == "kids" && $0.value == "1" }) == true

        if url.scheme?.lowercased() == "ayin" {
            let host = url.host?.lowercased() ?? ""
            let slug = url.pathComponents.dropFirst().first
            if host == "watch", let slug, validSlug(slug) {
                return .video(slug: slug, isKids: isKids)
            }
            if host == "live", let slug, validSlug(slug) { return .live(slug: slug) }
            return nil
        }

        guard url.scheme?.lowercased() == "https", url.host?.lowercased() == "ayin.stream" else {
            return nil
        }

        var components = url.pathComponents.filter { $0 != "/" }
        if let first = components.first, first == "en" || first == "ar" {
            components.removeFirst()
        }

        if components.count == 2, components[0] == "watch", validSlug(components[1]) {
            return .video(slug: components[1], isKids: isKids)
        }
        if components.count == 2, components[0] == "live", validSlug(components[1]) {
            return .live(slug: components[1])
        }
        return .web(url)
    }

    private static func validSlug(_ value: String) -> Bool {
        guard !value.isEmpty, value.count <= 160 else { return false }
        return value.unicodeScalars.allSatisfy {
            CharacterSet.alphanumerics.contains($0) || "-_.".unicodeScalars.contains($0)
        }
    }
}

struct PlayerDestination: Identifiable, Equatable {
    enum Kind: Equatable { case video, live }
    let kind: Kind
    let slug: String
    let isKids: Bool

    init(kind: Kind, slug: String, isKids: Bool = false) {
        self.kind = kind
        self.slug = slug
        self.isKids = isKids
    }

    var id: String { "\(kind)-\(slug)-\(isKids ? "kids" : "general")" }

    var shareURL: URL {
        switch kind {
        case .video:
            return AppEnvironment.webBaseURL.appending(path: "watch").appending(path: slug)
        case .live:
            return AppEnvironment.webBaseURL.appending(path: "live").appending(path: slug)
        }
    }
}
