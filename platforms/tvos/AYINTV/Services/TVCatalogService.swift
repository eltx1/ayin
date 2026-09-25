import Foundation

struct TVCatalogService {
    private let client: APIClient

    init(client: APIClient = APIClient(baseURL: AppEnvironment.apiBaseURL)) {
        self.client = client
    }

    func search(_ query: String, limit: Int = 24) async throws -> TVSearchResponse {
        var components = URLComponents()
        components.path = "/public/search"
        components.queryItems = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "limit", value: String(limit))
        ]
        guard let path = components.string else { throw APIClientError.invalidURL }
        return try await client.request(path)
    }

    func myAyin(token: String, profileId: String) async throws -> TVMyAyinResponse {
        let encoded = profileId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? profileId
        return try await client.request("/discovery/my-ayin?profileId=\(encoded)", token: token)
    }

    func channel(handle: String) async throws -> TVChannelResponse {
        try await client.request("/public/channels/\(handle)")
    }

    func creatorTV(handle: String) async throws -> TVCreatorTVResponse {
        try await client.request("/public/channels/\(handle)/tv")
    }

    func creatorTVLinear(handle: String) async throws -> TVLinearCapabilityResponse {
        try await client.request("/public/channels/\(handle)/tv/linear")
    }

    func movie(slug: String) async throws -> TVMovieResponse {
        try await client.request("/public/movies/\(slug)")
    }

    func series(slug: String) async throws -> TVSeriesResponse {
        try await client.request("/public/series/\(slug)")
    }
}
