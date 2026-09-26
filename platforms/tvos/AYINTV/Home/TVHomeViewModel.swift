import Combine
import Foundation

@MainActor
final class TVHomeViewModel: ObservableObject {
    @Published private(set) var rows: [TVDiscoveryRow] = []
    @Published private(set) var isLoading = false
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
}
