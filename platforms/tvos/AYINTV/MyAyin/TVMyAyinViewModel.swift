import Combine
import Foundation

@MainActor
final class TVMyAyinViewModel: ObservableObject {
    @Published private(set) var sections: [TVMyAyinResponse.Section] = []
    @Published private(set) var isLoading = false
    @Published private(set) var loadingSectionKeys: Set<String> = []
    @Published var errorMessage: String?

    private let catalog: TVCatalogService

    init(catalog: TVCatalogService = TVCatalogService()) {
        self.catalog = catalog
    }

    func load(token: String, profileId: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            sections = try await catalog.myAyin(token: token, profileId: profileId).sections
            errorMessage = nil
        } catch {
            sections = []
            errorMessage = error.localizedDescription
        }
    }

    func loadMore(sectionKey: String, token: String, profileId: String) async {
        guard
            !loadingSectionKeys.contains(sectionKey),
            let index = sections.firstIndex(where: { $0.key == sectionKey }),
            let cursor = sections[index].nextCursor
        else { return }

        loadingSectionKeys.insert(sectionKey)
        defer { loadingSectionKeys.remove(sectionKey) }

        do {
            let page = try await catalog.myAyinSection(
                token: token,
                profileId: profileId,
                section: sectionKey,
                cursor: cursor
            )
            guard let latestIndex = sections.firstIndex(where: { $0.key == sectionKey }) else {
                return
            }

            let current = sections[latestIndex]
            let existingIds = Set(current.items.map(\.id))
            let newItems = page.items.filter { !existingIds.contains($0.id) }
            sections[latestIndex] = TVMyAyinResponse.Section(
                key: current.key,
                title: current.title,
                items: current.items + newItems,
                nextCursor: page.nextCursor,
                availability: page.availability ?? current.availability,
                emptyMessage: page.emptyMessage ?? current.emptyMessage
            )
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func isLoadingMore(_ sectionKey: String) -> Bool {
        loadingSectionKeys.contains(sectionKey)
    }
}
