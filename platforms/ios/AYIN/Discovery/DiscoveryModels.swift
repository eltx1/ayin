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

    private enum CodingKeys: String, CodingKey {
        case id, type, title, href, kicker, meta, artworkObjectKey, progress
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        type = try values.decode(String.self, forKey: .type)
        title = try values.decode(String.self, forKey: .title)
        href = try values.decode(String.self, forKey: .href)
        kicker = try values.decode(String.self, forKey: .kicker)
        meta = try values.decodeIfPresent(String.self, forKey: .meta)
        artworkObjectKey = try values.decodeIfPresent(String.self, forKey: .artworkObjectKey)
        progress = try values.decodeIfPresent(Progress.self, forKey: .progress)
    }
}

struct EmptyResponse: Decodable {}
