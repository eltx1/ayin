import Foundation

protocol WatchProgressServicing {
    func progress(videoId: String, profileId: String?, token: String) async throws -> WatchProgress
    func save(
        videoId: String,
        profileId: String?,
        positionMs: Int,
        durationMs: Int?,
        expectedRevision: String?,
        token: String
    ) async throws -> WatchProgress
}

struct WatchProgress: Decodable, Equatable {
    let profileId: String
    let videoId: String
    let positionMs: Int
    let completedAt: String?
    let revision: String?

    enum CodingKeys: String, CodingKey {
        case profileId, videoId, positionMs, completedAt, revision
    }

    init(profileId: String, videoId: String, positionMs: Int, completedAt: String?, revision: String?) {
        self.profileId = profileId
        self.videoId = videoId
        self.positionMs = positionMs
        self.completedAt = completedAt
        self.revision = revision
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        profileId = try values.decode(String.self, forKey: .profileId)
        videoId = try values.decode(String.self, forKey: .videoId)
        positionMs = try values.decode(Int.self, forKey: .positionMs)
        completedAt = try values.decodeIfPresent(String.self, forKey: .completedAt)
        // Missing is not the same as an authoritative first-write null revision.
        guard values.contains(.revision), positionMs >= 0 else {
            throw APIClientError.invalidResponse
        }
        revision = try values.decodeIfPresent(String.self, forKey: .revision)
        if let revision {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            guard formatter.date(from: revision) != nil else { throw APIClientError.invalidResponse }
        }
    }
}

struct WatchProgressService: WatchProgressServicing {
    private let client: APIClient

    init(client: APIClient = APIClient(baseURL: AppEnvironment.apiBaseURL)) {
        self.client = client
    }

    func progress(videoId: String, profileId: String?, token: String) async throws -> WatchProgress {
        let query = profileId.map { "?profileId=\($0)" } ?? ""
        let progress: WatchProgress = try await client.request("/watch/progress/\(videoId)\(query)", token: token)
        return try validate(progress, videoId: videoId, profileId: profileId)
    }

    func save(
        videoId: String,
        profileId: String?,
        positionMs: Int,
        durationMs: Int?,
        expectedRevision: String?,
        token: String
    ) async throws -> WatchProgress {
        let progress: WatchProgress = try await client.request(
            "/watch/progress/\(videoId)",
            method: "PUT",
            token: token,
            body: SaveWatchProgressRequest(
                profileId: profileId,
                positionMs: max(0, positionMs),
                durationMs: durationMs,
                expectedRevision: expectedRevision
            )
        )
        guard progress.revision != nil else { throw APIClientError.invalidResponse }
        return try validate(progress, videoId: videoId, profileId: profileId)
    }

    private func validate(_ progress: WatchProgress, videoId: String, profileId: String?) throws -> WatchProgress {
        guard progress.videoId == videoId, profileId == nil || progress.profileId == profileId else {
            throw APIClientError.invalidResponse
        }
        return progress
    }
}

private struct SaveWatchProgressRequest: Encodable {
    let profileId: String?
    let positionMs: Int
    let durationMs: Int?
    let expectedRevision: String?

    enum CodingKeys: String, CodingKey {
        case profileId, positionMs, durationMs, expectedRevision
    }

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encodeIfPresent(profileId, forKey: .profileId)
        try values.encode(positionMs, forKey: .positionMs)
        try values.encodeIfPresent(durationMs, forKey: .durationMs)
        // encodeIfPresent would silently restore the server's legacy unconditional-write path.
        if let expectedRevision {
            try values.encode(expectedRevision, forKey: .expectedRevision)
        } else {
            try values.encodeNil(forKey: .expectedRevision)
        }
    }
}
