import XCTest
@testable import AYIN

final class NativeServicesTests: XCTestCase {
    override func tearDown() {
        TestURLProtocol.handler = nil
        super.tearDown()
    }

    func testKidsPlaybackRequestRetainsKidsPolicyAndNativeIdentity() async throws {
        var captured: URLRequest?
        TestURLProtocol.handler = { request in
            captured = request
            let body = Data("""
            {
              "video": {
                "id": "11111111-1111-4111-8111-111111111111",
                "slug": "kids-show",
                "title": "Kids Show",
                "durationMs": 60000,
                "channel": {"id": "22222222-2222-4222-8222-222222222222"},
                "source": {
                  "objectKey": "videos/kids/fallback.mp4",
                  "mimeType": "video/mp4"
                },
                "adaptiveSource": {
                  "objectKey": "videos/kids/master.m3u8",
                  "mimeType": "application/vnd.apple.mpegurl"
                }
              }
            }
            """.utf8)
            return (testHTTPResponse(for: request), body)
        }

        let service = PlaybackService(client: makeTestAPIClient())
        let playback = try await service.load(
            PlayerDestination(kind: .video, slug: "kids-show", isKids: true)
        )

        let components = try XCTUnwrap(
            URLComponents(url: try XCTUnwrap(captured?.url), resolvingAgainstBaseURL: false)
        )
        XCTAssertEqual(components.path, "/public/videos/kids-show/playback")
        XCTAssertEqual(components.queryItems?.first(where: { $0.name == "kids" })?.value, "1")
        XCTAssertTrue(playback.isKids)
        XCTAssertEqual(playback.videoId, "11111111-1111-4111-8111-111111111111")
        XCTAssertEqual(playback.channelId, "22222222-2222-4222-8222-222222222222")
        XCTAssertEqual(playback.protocolName, "HLS")
        XCTAssertTrue(playback.sourceURL.absoluteString.contains("master.m3u8"))
    }

    func testNativeAnalyticsUsesMobileSourceAndExistingEventsEndpoint() async throws {
        var captured: URLRequest?
        TestURLProtocol.handler = { request in
            captured = request
            return (
                testHTTPResponse(for: request),
                Data(#"{"accepted":1,"duplicateOrInvalid":0}"#.utf8)
            )
        }

        let analytics = NativeAnalyticsClient(client: makeTestAPIClient())
        await analytics.emit(
            "VIDEO_START",
            profileId: "33333333-3333-4333-8333-333333333333",
            videoId: "11111111-1111-4111-8111-111111111111",
            channelId: "22222222-2222-4222-8222-222222222222",
            durationDeltaMs: nil,
            positionMs: 0,
            metadata: ["protocol": "HLS"]
        )

        let request = try XCTUnwrap(captured)
        XCTAssertEqual(request.url?.path, "/analytics/events")
        let body = try XCTUnwrap(request.httpBody)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        let events = try XCTUnwrap(json["events"] as? [[String: Any]])
        let event = try XCTUnwrap(events.first)
        XCTAssertEqual(event["eventName"] as? String, "VIDEO_START")
        XCTAssertEqual(event["source"] as? String, "MOBILE")
        XCTAssertEqual(event["videoId"] as? String, "11111111-1111-4111-8111-111111111111")
        XCTAssertTrue((event["sessionId"] as? String)?.count ?? 0 >= 16)
    }

    func testWatchProgressReadsAndWritesExistingAPIWithBearerSession() async throws {
        var requests: [URLRequest] = []
        TestURLProtocol.handler = { request in
            requests.append(request)
            if request.httpMethod == "GET" {
                return (
                    testHTTPResponse(for: request),
                    Data(#"{"positionMs":42000,"completedAt":null}"#.utf8)
                )
            }
            return (
                testHTTPResponse(for: request),
                Data(#"{"positionMs":45000}"#.utf8)
            )
        }

        let service = WatchProgressService(client: makeTestAPIClient())
        let videoId = "11111111-1111-4111-8111-111111111111"
        let profileId = "33333333-3333-4333-8333-333333333333"
        let progress = try await service.progress(
            videoId: videoId,
            profileId: profileId,
            token: "session-token"
        )
        XCTAssertEqual(progress.positionMs, 42000)

        try await service.save(
            videoId: videoId,
            profileId: profileId,
            positionMs: 45000,
            durationMs: 60000,
            token: "session-token"
        )

        XCTAssertEqual(requests.count, 2)
        XCTAssertEqual(requests[0].value(forHTTPHeaderField: "Authorization"), "Bearer session-token")
        XCTAssertTrue(requests[0].url?.absoluteString.contains("profileId=") == true)
        XCTAssertEqual(requests[1].httpMethod, "PUT")
        XCTAssertEqual(requests[1].value(forHTTPHeaderField: "Authorization"), "Bearer session-token")

        let saveBody = try XCTUnwrap(requests[1].httpBody)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: saveBody) as? [String: Any])
        XCTAssertEqual(json["positionMs"] as? Int, 45000)
        XCTAssertEqual(json["durationMs"] as? Int, 60000)
        XCTAssertEqual(json["profileId"] as? String, profileId)
    }
}
