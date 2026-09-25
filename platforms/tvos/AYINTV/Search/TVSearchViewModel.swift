import Combine
import Foundation

@MainActor
final class TVSearchViewModel: ObservableObject {
    @Published private(set) var items: [DiscoveryItem] = []
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?

    private let catalog: TVCatalogService
    private var task: Task<Void, Never>?

    init(catalog: TVCatalogService = TVCatalogService()) {
        self.catalog = catalog
    }

    func search(_ raw: String) {
        task?.cancel()
        let query = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.count >= 2 else {
            items = []
            errorMessage = nil
            return
        }

        task = Task { @MainActor [weak self] in
            guard let self else { return }
            self.isLoading = true
            defer { self.isLoading = false }
            do {
                let response = try await self.catalog.search(query)
                guard !Task.isCancelled else { return }
                self.items = response.items
                self.errorMessage = response.emptyMessage
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                self.items = []
                self.errorMessage = error.localizedDescription
            }
        }
    }

    deinit { task?.cancel() }
}
