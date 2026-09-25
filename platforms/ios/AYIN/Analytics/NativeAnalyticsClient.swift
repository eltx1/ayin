import Foundation
import UIKit

protocol AnalyticsTracking {
    func emit(
        _ eventName: String,
        profileId: String?,
        videoId: String?,
        channelId: String?,
        durationDeltaMs: Int?,
        positionMs: Int?,
        metadata: [String: String]
    ) async
}

struct NativeAnalyticsClient: AnalyticsTracking {
    private static let sessionId = UUID().uuidString
    private let client: APIClient

    init(client: APIClient = APIClient(baseURL: AppEnvironment.apiBaseURL)) {
        self.client = client
    }

    func emit(
        _ eventName: String,
        profileId: String? = nil,
        videoId: String? = nil,
        channelId: String? = nil,
        durationDeltaMs: Int? = nil,
        positionMs: Int? = nil,
        metadata: [String: String] = [:]
    ) async {
        let event = NativeAnalyticsEvent(
            clientEventId: UUID().uuidString,
            schemaVersion: 1,
            eventName: eventName,
            occurredAt: ISO8601DateFormatter().string(from: Date()),
            sessionId: Self.sessionId,
            profileId: profileId,
            videoId: videoId,
            channelId: channelId,
            source: "MOBILE",
            deviceClass: UIDevice.current.userInterfaceIdiom == .pad ? "TABLET" : "MOBILE",
            durationDeltaMs: durationDeltaMs,
            positionMs: positionMs,
            metadata: metadata.isEmpty ? nil : metadata
        )
        do {
            let _: AnalyticsAcceptedResponse = try await client.request(
                "/analytics/events",
                method: "POST",
                body: AnalyticsBatch(events: [event])
            )
        } catch {
            // Analytics is best-effort and must never block playback.
        }
    }
}

private struct AnalyticsBatch: Encodable {
    let events: [NativeAnalyticsEvent]
}

private struct NativeAnalyticsEvent: Encodable {
    let clientEventId: String
    let schemaVersion: Int
    let eventName: String
    let occurredAt: String
    let sessionId: String
    let profileId: String?
    let videoId: String?
    let channelId: String?
    let source: String
    let deviceClass: String
    let durationDeltaMs: Int?
    let positionMs: Int?
    let metadata: [String: String]?
}

private struct AnalyticsAcceptedResponse: Decodable {
    let accepted: Int
    let duplicateOrInvalid: Int
}
