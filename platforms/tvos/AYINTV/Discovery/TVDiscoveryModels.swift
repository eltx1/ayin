import Foundation

struct TVDiscoveryHomeResponse: Decodable {
    let rows: [TVDiscoveryRow]
}

struct TVDiscoveryRow: Decodable, Identifiable {
    let key: String
    let title: String
    let items: [TVDiscoveryItem]
    let nextCursor: String?
    let availability: String?
    let emptyMessage: String?

    var id: String { key }
}

struct TVDiscoveryItem: Decodable, Identifiable {
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
    let artworkObjectKey: String?
    let progress: Progress?

    init(
        id: String,
        type: String,
        title: String,
        href: String,
        kicker: String,
        meta: String?,
        artworkObjectKey: String? = nil,
        progress: Progress? = nil
    ) {
        self.id = id
        self.type = type
        self.title = title
        self.href = href
        self.kicker = kicker
        self.meta = meta
        self.artworkObjectKey = artworkObjectKey
        self.progress = progress
    }
}
