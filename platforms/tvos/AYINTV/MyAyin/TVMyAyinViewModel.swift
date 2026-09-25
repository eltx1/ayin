import Combine
import Foundation

@MainActor
final class TVMyAyinViewModel: ObservableObject {
    @Published private(set) var sections: [TVMyAyinResponse.Section] = []
    @Published private(set) var isLoading = false
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
}
