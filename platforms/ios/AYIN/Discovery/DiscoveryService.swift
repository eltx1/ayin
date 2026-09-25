import Foundation

protocol DiscoveryServicing {
    func home(token: String?) async throws -> DiscoveryHomeResponse
}

struct DiscoveryService: DiscoveryServicing {
    private let client: APIClient

    init(client: APIClient = APIClient(baseURL: AppEnvironment.apiBaseURL)) {
        self.client = client
    }

    func home(token: String?) async throws -> DiscoveryHomeResponse {
        if let token {
            return try await client.request("/discovery/home", token: token)
        }
        return try await client.request("/public/discovery/home")
    }
}
