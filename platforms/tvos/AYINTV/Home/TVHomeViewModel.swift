import Combine
import Foundation

@MainActor
final class TVHomeViewModel: ObservableObject {
    @Published private(set) var rows: [TVDiscoveryRow] = []
    @Published private(set) var isLoading = false
    @Published private(set) var loadingRowKeys: Set<String> = []
    @Published var errorMessage: String?

    private let discovery: any TVDiscoveryServicing
    private var generation = 0

    init(discovery: any TVDiscoveryServicing = TVDiscoveryService()) {
        self.discovery = discovery
    }

    func load(token: String?) async {
        generation += 1
        let current = generation
        isLoading = true
        defer {
            if current == generation { isLoading = false }
        }

        do {
            let response = try await discovery.home(token: token)
            guard current == generation, !Task.isCancelled else { return }
            rows = response.rows
            errorMessage = nil
        } catch {
            guard current == generation, !Task.isCancelled else { return }
            rows = []
            errorMessage = error.localizedDescription
        }
    }

    func loadMore(rowKey: String, token: String?) async {
        guard
            !loadingRowKeys.contains(rowKey),
            let index = rows.firstIndex(where: { $0.key == rowKey }),
            let cursor = rows[index].nextCursor
        else { return }

        loadingRowKeys.insert(rowKey)
        defer { loadingRowKeys.remove(rowKey) }

        do {
            let page = try await discovery.row(
                key: rowKey,
                cursor: cursor,
                token: token,
                limit: 24
            )
            guard let latestIndex = rows.firstIndex(where: { $0.key == rowKey }) else { return }

            let current = rows[latestIndex]
            let existingIds = Set(current.items.map(\.id))
            let newItems = page.items.filter { !existingIds.contains($0.id) }

            rows[latestIndex] = TVDiscoveryRow(
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

    func isLoadingMore(_ rowKey: String) -> Bool {
        loadingRowKeys.contains(rowKey)
    }
}
