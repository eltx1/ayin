import Foundation

struct DiscoveryService {
    private let client: APIClient

    init(client: APIClient = APIClient(baseURL: AppEnvironment.apiBaseURL)) {
        self.client = client
    }

    func home(token: String?) async throws -> DiscoveryHomeResponse {
        if let token {
            do {
                return try await client.request("/discovery/home", token: token)
            } catch let APIClientError.server(status, _) where status == 401 {
                return try await client.request("/public/discovery/home")
            }
        }
        return try await client.request("/public/discovery/home")
    }
}
