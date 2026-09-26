import Foundation

struct DiscoveryHomeResponse: Decodable {
    let rows: [DiscoveryRow]
}

struct DiscoveryRow: Decodable, Identifiable {
    let key: String
    let title: String
    let items: [DiscoveryItem]
    let availability: String?

    var id: String { key }
}

struct DiscoveryItem: Decodable, Identifiable {
    struct Progress: Decodable, Equatable {
        let positionMs: Int
        let completedAt: String?
    }

    let id: String
    let type: String
    let title: String
    let href: String
    let kicker: String
    let meta: String?
    let artworkObjectKey: String? = nil
    let progress: Progress? = nil
}

struct EmptyResponse: Decodable {}
