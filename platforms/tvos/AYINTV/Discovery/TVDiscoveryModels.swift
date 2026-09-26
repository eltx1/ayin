import Foundation

struct TVDiscoveryHomeResponse: Decodable {
    let rows: [TVDiscoveryRow]
}

struct TVDiscoveryRow: Decodable, Identifiable {
    let key: String
    let title: String
    let items: [TVDiscoveryItem]
    let availability: String?

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
}
