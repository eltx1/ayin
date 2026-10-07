import Foundation

struct DiscoveryHomeResponse: Decodable {
    let rows: [DiscoveryRow]
}

struct DiscoveryRow: Decodable, Identifiable {
    let key: String
    let title: String
    let items: [DiscoveryItem]
    let availability: String?
    let nextCursor: String?

    var id: String { key }

    var hasMore: Bool {
        guard let nextCursor else { return false }
        return !nextCursor.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

struct DiscoveryItem: Decodable, Identifiable {
    let id: String
    let type: String
    let title: String
    let href: String
    let kicker: String
    let meta: String?
    let artworkObjectKey: String?
}

struct EmptyResponse: Decodable {}
