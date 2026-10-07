import XCTest
@testable import AYINTV

final class TVPlaybackViewerPolicyTests: XCTestCase {
    override func tearDown() {
        ViewerURLProtocol.handler = nil
        super.tearDown()
    }

    func testOrdinaryAndKidsLinksForwardViewerAndRetainAuthoritativePolicy() async throws {
        for authenticated in [false, true] {
            for profileIsKids in [false, true] where authenticated || !profileIsKids {
                for routeIsKids in [false, true] {
                    for serverIsKids in [false, true] {
                        var captured: URLRequest?
                        ViewerURLProtocol.handler = { request in
                            captured = request
                            return (200, Data("""
                            {"viewer":{"isKids":\(serverIsKids)},
                             "video":{"id":"video","slug":"show","title":"Show","durationMs":60000,
                              "channel":{"id":"channel","handle":"channel","name":"Channel"},
                              "source":{"objectKey":"show.mp4","mimeType":"video/mp4"},
                              "adaptiveSource":{"objectKey":"show.m3u8","mimeType":"application/vnd.apple.mpegurl"},
                              "captions":[]}}
                            """.utf8))
                        }
                        let url = try XCTUnwrap(URL(string: "ayin-tv://watch/show\(routeIsKids ? "?kids=1" : "")"))
                        let route = try XCTUnwrap(TVRoute.parse(url: url))
                        let destination = try XCTUnwrap(TVRoute.playerDestination(for: route))
                        let asset = try await TVPlaybackService(client: viewerClient()).load(
                            destination, token: authenticated ? "viewer-token" : nil,
                            accountId: authenticated ? "account" : nil,
                            profileId: authenticated ? "profile" : nil, isKids: profileIsKids
                        )
                        let request = try XCTUnwrap(captured)
                        let query = URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)?.queryItems
                        XCTAssertEqual(request.url?.path, "/public/videos/show/playback")
                        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), authenticated ? "Bearer viewer-token" : nil)
                        XCTAssertEqual(request.value(forHTTPHeaderField: "X-AYIN-Expected-Account"), authenticated ? "account" : nil)
                        XCTAssertEqual(query?.first { $0.name == "expectedProfileId" }?.value, authenticated ? "profile" : nil)
                        XCTAssertEqual(query?.first { $0.name == "kids" }?.value, profileIsKids || routeIsKids ? "1" : nil)
                        let effectiveKids = profileIsKids || routeIsKids || serverIsKids
                        XCTAssertEqual(asset.isKids, effectiveKids)
                        XCTAssertEqual(asset.shareURL.query?.contains("kids=1") == true, effectiveKids)
                        XCTAssertEqual(asset.mp4Fallback()?.isKids, effectiveKids)
                    }
                }
            }
        }
    }

    func testDeniedViewerIsNeverRetriedAsAnonymous() async throws {
        for status in [401, 403, 409] {
            var requests = 0
            ViewerURLProtocol.handler = { request in
                requests += 1
                XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer revoked-token")
                return (status, Data(#"{"error":{"message":"Viewer changed"}} "#.utf8))
            }
            do {
                _ = try await TVPlaybackService(client: viewerClient()).load(
                    .video(slug: "adult", isKids: false),
                    token: "revoked-token", accountId: "account", profileId: "profile", isKids: true
                )
                XCTFail("Denied playback must not return media")
            } catch let error as APIClientError {
                XCTAssertEqual(error.statusCode, status)
            }
            XCTAssertEqual(requests, 1)
        }
    }
}

private func viewerClient() -> APIClient {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [ViewerURLProtocol.self]
    return APIClient(baseURL: URL(string: "https://api.ayin.test")!,
                     session: URLSession(configuration: configuration))
}

private final class ViewerURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            guard let handler = Self.handler else { throw URLError(.badServerResponse) }
            let (status, data) = try handler(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
                                           headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }
    override func stopLoading() {}
}
