import Foundation

protocol TVDiscoveryServicing {
    func home(token: String?) async throws -> TVDiscoveryHomeResponse
}

struct TVDiscoveryService: TVDiscoveryServicing {
    private let client: APIClient

    init(client: APIClient = APIClient(baseURL: AppEnvironment.apiBaseURL)) {
        self.client = client
    }

    func home(token: String?) async throws -> TVDiscoveryHomeResponse {
        if let token {
            return try await client.request("/discovery/home", token: token)
        }
        return try await client.request("/public/discovery/home")
    }
}
