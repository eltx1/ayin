import XCTest
@testable import AYIN

final class NativeServicesTests: XCTestCase {
    override func tearDown() {
        TestURLProtocol.handler = nil
        super.tearDown()
    }

    func testAPIErrorLocalizesOnlyItsMissingMessageFallback() async throws {
        for (body, expected) in [
            (#"{}"#, NSLocalizedString("AYIN request failed.", comment: "")),
            (#"{"error":{"message":"Sign in"}}"#, "Sign in"),
            (#"{"message":"Server-owned error"}"#, "Server-owned error")
        ] {
            TestURLProtocol.handler = { request in
                XCTAssertEqual(request.url?.path, "/discovery/home")
                XCTAssertNil(request.url?.query)
                return (testHTTPResponse(for: request, statusCode: 503), Data(body.utf8))
            }
            do {
                let _: DiscoveryHomeResponse = try await makeTestAPIClient().request("/discovery/home")
                XCTFail("Expected the server rejection")
            } catch let error as APIClientError {
                XCTAssertEqual(error.statusCode, 503)
                XCTAssertEqual(error.errorDescription, expected)
            }
        }
    }

    func testNoContentAPIFailureUsesLocalizedFallback() async throws {
        TestURLProtocol.handler = { request in
            (testHTTPResponse(for: request, statusCode: 503), Data())
        }
        do {
            try await makeTestAPIClient().requestNoContent("/auth/logout", method: "POST", token: nil)
            XCTFail("Expected the server rejection")
        } catch let error as APIClientError {
            XCTAssertEqual(error.statusCode, 503)
            XCTAssertEqual(error.errorDescription, NSLocalizedString("AYIN request failed.", comment: ""))
        }
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
        XCTAssertTrue(playback.fallbackSourceURL?.absoluteString.contains("fallback.mp4") == true)

        let fallback = try XCTUnwrap(playback.usingMP4Fallback())
        XCTAssertEqual(fallback.protocolName, "MP4")
        XCTAssertNil(fallback.fallbackSourceURL)
        XCTAssertTrue(fallback.sourceURL.absoluteString.contains("fallback.mp4"))
    }

    func testNativeAnalyticsUsesMobileSourceAndExistingEventsEndpoint() async throws {
        var captured: URLRequest?
        var capturedBody: Data?
        TestURLProtocol.handler = { request in
            captured = request
            capturedBody = try requestBodyData(request)
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
        let body = try XCTUnwrap(capturedBody)
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
        var saveBody: Data?
        TestURLProtocol.handler = { request in
            requests.append(request)
            if request.httpMethod == "GET" {
                return (
                    testHTTPResponse(for: request),
                    Data(#"{"profileId":"33333333-3333-4333-8333-333333333333","videoId":"11111111-1111-4111-8111-111111111111","positionMs":42000,"completedAt":null,"revision":"2026-10-06T08:00:00.001Z"}"#.utf8)
                )
            }
            saveBody = try requestBodyData(request)
            return (
                testHTTPResponse(for: request),
                Data(#"{"profileId":"33333333-3333-4333-8333-333333333333","videoId":"11111111-1111-4111-8111-111111111111","positionMs":45000,"completedAt":null,"revision":"2026-10-06T08:00:00.002Z"}"#.utf8)
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

        let saved = try await service.save(
            videoId: videoId,
            profileId: profileId,
            positionMs: 45000,
            durationMs: 60000,
            expectedRevision: progress.revision,
            token: "session-token"
        )
        XCTAssertEqual(saved.revision, "2026-10-06T08:00:00.002Z")

        XCTAssertEqual(requests.count, 2)
        XCTAssertEqual(requests[0].value(forHTTPHeaderField: "Authorization"), "Bearer session-token")
        XCTAssertTrue(requests[0].url?.absoluteString.contains("profileId=") == true)
        XCTAssertEqual(requests[1].httpMethod, "PUT")
        XCTAssertEqual(requests[1].value(forHTTPHeaderField: "Authorization"), "Bearer session-token")

        let body = try XCTUnwrap(saveBody)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(json["positionMs"] as? Int, 45000)
        XCTAssertEqual(json["durationMs"] as? Int, 60000)
        XCTAssertEqual(json["profileId"] as? String, profileId)
        XCTAssertEqual(json["expectedRevision"] as? String, "2026-10-06T08:00:00.001Z")
    }

    func testFirstProgressWriteSendsExplicitNullRevision() async throws {
        var body: Data?
        TestURLProtocol.handler = { request in
            body = try requestBodyData(request)
            return (testHTTPResponse(for: request), Data(#"{"profileId":"p","videoId":"v","positionMs":5000,"completedAt":null,"revision":"2026-10-06T08:00:00.001Z"}"#.utf8))
        }
        _ = try await WatchProgressService(client: makeTestAPIClient()).save(
            videoId: "v", profileId: "p", positionMs: 5000,
            durationMs: nil, expectedRevision: nil, token: "session-token"
        )
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(body)) as? [String: Any])
        XCTAssertTrue(json["expectedRevision"] is NSNull)
    }

    func testProgressReadRejectsMissingRevisionAndForeignIdentity() async throws {
        for response in [
            #"{"profileId":"p","videoId":"v","positionMs":0,"completedAt":null}"#,
            #"{"profileId":"other","videoId":"v","positionMs":0,"completedAt":null,"revision":null}"#,
            #"{"profileId":"p","videoId":"other","positionMs":0,"completedAt":null,"revision":null}"#,
            #"{"profileId":"p","videoId":"v","positionMs":0,"completedAt":null,"revision":"broken"}"#
        ] {
            TestURLProtocol.handler = { request in (testHTTPResponse(for: request), Data(response.utf8)) }
            do {
                _ = try await WatchProgressService(client: makeTestAPIClient()).progress(videoId: "v", profileId: "p", token: "token")
                XCTFail("Unverifiable progress must not become a writable baseline")
            } catch {}
        }
    }

    func testConflictingCheckpointIsNotRetriedByTheTransport() async throws {
        var requests = 0
        TestURLProtocol.handler = { request in
            requests += 1
            return (
                testHTTPResponse(for: request, statusCode: 409),
                Data(#"{"error":{"code":"WATCH_PROGRESS_CONFLICT","message":"Read current progress before another checkpoint."}}"#.utf8)
            )
        }
        do {
            _ = try await WatchProgressService(client: makeTestAPIClient()).save(
                videoId: "v", profileId: "p", positionMs: 15000, durationMs: 60000,
                expectedRevision: "2026-10-06T08:00:00.001Z", token: "token"
            )
            XCTFail("A conflict must reach the revision state as an unacknowledged save")
        } catch let error as APIClientError {
            XCTAssertEqual(error.statusCode, 409)
        }
        XCTAssertEqual(requests, 1)
    }
}
