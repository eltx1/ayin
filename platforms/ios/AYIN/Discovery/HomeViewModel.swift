import Combine
import Foundation

@MainActor
final class HomeViewModel: ObservableObject {
    @Published private(set) var rows: [DiscoveryRow] = []
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?

    private let discovery: DiscoveryService

    init(discovery: DiscoveryService = DiscoveryService()) {
        self.discovery = discovery
    }

    func load(token: String?) async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            rows = try await discovery.home(token: token).rows
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
