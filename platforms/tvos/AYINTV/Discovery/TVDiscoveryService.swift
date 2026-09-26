import Foundation

protocol TVDiscoveryServicing {
    func home(token: String?) async throws -> TVDiscoveryHomeResponse
    func row(
        key: String,
        cursor: String,
        token: String?,
        limit: Int
    ) async throws -> TVDiscoveryPageResponse
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

    func row(
        key: String,
        cursor: String,
        token: String?,
        limit: Int = 24
    ) async throws -> TVDiscoveryPageResponse {
        var components = URLComponents()
        components.path = token == nil
            ? "/public/discovery/rows/\(key)"
            : "/discovery/rows/\(key)"
        components.queryItems = [
            URLQueryItem(name: "cursor", value: cursor),
            URLQueryItem(name: "limit", value: String(limit))
        ]
        guard let path = components.string else { throw APIClientError.invalidURL }
        return try await client.request(path, token: token)
    }
}
