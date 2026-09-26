import Combine
import Foundation

@MainActor
final class TVSearchViewModel: ObservableObject {
    @Published private(set) var items: [TVDiscoveryItem] = []
    @Published private(set) var nextCursor: String?
    @Published private(set) var isLoading = false
    @Published private(set) var isLoadingMore = false
    @Published var errorMessage: String?

    private let catalog: TVCatalogService
    private var task: Task<Void, Never>?
    private var currentQuery = ""
    private var currentIsKids = false

    init(catalog: TVCatalogService = TVCatalogService()) {
        self.catalog = catalog
    }

    func search(_ raw: String, isKids: Bool) {
        task?.cancel()
        let query = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        currentQuery = query
        currentIsKids = isKids

        guard query.count >= 2 else {
            items = []
            nextCursor = nil
            errorMessage = nil
            return
        }

        task = Task { @MainActor [weak self] in
            guard let self else { return }
            self.isLoading = true
            defer { self.isLoading = false }
            do {
                let response = try await self.catalog.search(
                    query,
                    cursor: nil,
                    isKids: isKids
                )
                guard !Task.isCancelled, self.currentQuery == query, self.currentIsKids == isKids else {
                    return
                }
                self.items = response.items
                self.nextCursor = response.nextCursor
                self.errorMessage = response.emptyMessage
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                self.items = []
                self.nextCursor = nil
                self.errorMessage = error.localizedDescription
            }
        }
    }

    func loadMore() {
        guard
            !isLoading,
            !isLoadingMore,
            let cursor = nextCursor,
            currentQuery.count >= 2
        else { return }

        let query = currentQuery
        let isKids = currentIsKids
        isLoadingMore = true
        Task { @MainActor [weak self] in
            guard let self else { return }
            defer { self.isLoadingMore = false }
            do {
                let response = try await self.catalog.search(
                    query,
                    cursor: cursor,
                    isKids: isKids
                )
                guard self.currentQuery == query, self.currentIsKids == isKids else { return }
                let existingIds = Set(self.items.map(\.id))
                self.items.append(contentsOf: response.items.filter { !existingIds.contains($0.id) })
                self.nextCursor = response.nextCursor
                self.errorMessage = nil
            } catch {
                self.errorMessage = error.localizedDescription
            }
        }
    }

    deinit { task?.cancel() }
}
