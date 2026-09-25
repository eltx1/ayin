import Foundation

protocol WatchProgressServicing {
    func progress(videoId: String, profileId: String?, token: String) async throws -> WatchProgress
    func save(
        videoId: String,
        profileId: String?,
        positionMs: Int,
        durationMs: Int?,
        token: String
    ) async throws
}

struct WatchProgress: Decodable, Equatable {
    let positionMs: Int
    let completedAt: String?
}

struct WatchProgressService: WatchProgressServicing {
    private let client: APIClient

    init(client: APIClient = APIClient(baseURL: AppEnvironment.apiBaseURL)) {
        self.client = client
    }

    func progress(videoId: String, profileId: String?, token: String) async throws -> WatchProgress {
        let query = profileId.map { "?profileId=\($0)" } ?? ""
        return try await client.request("/watch/progress/\(videoId)\(query)", token: token)
    }

    func save(
        videoId: String,
        profileId: String?,
        positionMs: Int,
        durationMs: Int?,
        token: String
    ) async throws {
        let _: SaveWatchProgressResponse = try await client.request(
            "/watch/progress/\(videoId)",
            method: "PUT",
            token: token,
            body: SaveWatchProgressRequest(
                profileId: profileId,
                positionMs: max(0, positionMs),
                durationMs: durationMs
            )
        )
    }
}

private struct SaveWatchProgressRequest: Encodable {
    let profileId: String?
    let positionMs: Int
    let durationMs: Int?
}

private struct SaveWatchProgressResponse: Decodable {
    let positionMs: Int
}
