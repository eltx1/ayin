import XCTest
@testable import AYIN

@MainActor
final class HomeViewModelTests: XCTestCase {
    func testIdentityChangeConcealsContentBeforeReplacementTaskBegins() async {
        let model = HomeViewModel(discovery: SequenceDiscoveryService([
            .success(home(title: "Private history"))
        ]))
        model.prepareForSession(scope: "account-a:profile-a:false")
        _ = await model.load(token: "account-token")
        XCTAssertEqual(model.contentState(for: "account-a:profile-a:false"), .content)

        // No prepareForSession or replacement request has run yet.
        for scope in ["guest", "account-b:profile-a:false", "account-a:profile-b:false", "account-a:profile-a:true"] {
            XCTAssertEqual(model.contentState(for: scope), .loading)
        }
    }

    func testNoConfiguredRowsShowsEmptyStateAndCanRetry() async {
        let model = HomeViewModel(discovery: SequenceDiscoveryService([
            .success(DiscoveryHomeResponse(rows: [])),
            .success(home(title: "New on AYIN"))
        ]))
        model.prepareForSession(scope: "guest")

        let emptyLoad = await model.load(token: nil)
        XCTAssertEqual(emptyLoad, .loaded)
        XCTAssertEqual(model.contentState, .empty)

        let retry = await model.load(token: nil)
        XCTAssertEqual(retry, .loaded)
        XCTAssertEqual(model.contentState, .content)
    }

    func testAllEmptyOrUnavailableRowsShowEmptyStateInsteadOfBlankScrollView() async {
        let model = HomeViewModel(discovery: SequenceDiscoveryService([
            .success(emptyHome())
        ]))
        _ = await model.load(token: nil)
        XCTAssertFalse(model.rows.isEmpty)
        XCTAssertEqual(model.contentState, .empty)
    }

    func testFailureAfterEmptyRowsShowsRetryableError() async {
        let error = URLError(.notConnectedToInternet)
        let model = HomeViewModel(discovery: SequenceDiscoveryService([
            .success(emptyHome()), .failure(error)
        ]))
        _ = await model.load(token: nil)
        _ = await model.load(token: nil)
        XCTAssertEqual(model.contentState, .unavailable(error.localizedDescription))
    }

    func testRefreshFailureRetainsVisibleContent() async {
        let model = HomeViewModel(discovery: SequenceDiscoveryService([
            .success(home(title: "New on AYIN")),
            .failure(URLError(.notConnectedToInternet))
        ]))
        _ = await model.load(token: nil)
        _ = await model.load(token: nil)
        XCTAssertEqual(model.contentState, .content)
    }

    func testReplacedProfileResponseCannotReplaceEmptyStateWithStaleContent() async {
        let service = SuspendedDiscoveryService()
        let model = HomeViewModel(discovery: service)
        model.prepareForSession(scope: "account-a:profile-a:false")
        let load = Task { await model.load(token: "account-token") }
        await service.waitUntilRequested()
        XCTAssertEqual(model.contentState, .loading)

        model.prepareForSession(scope: "guest")
        await service.finish(with: home(title: "Private history"))

        let result = await load.value
        XCTAssertEqual(result, .superseded)
        XCTAssertEqual(model.contentState, .empty)
        XCTAssertTrue(model.rows.isEmpty)
        XCTAssertFalse(model.isLoading)
    }

    func testCancelledRequestWithoutScopeChangeCannotPublishContent() async {
        let service = SuspendedDiscoveryService()
        let model = HomeViewModel(discovery: service)
        model.prepareForSession(scope: "guest")
        let load = Task { await model.load(token: nil) }
        await service.waitUntilRequested()

        load.cancel()
        await service.finish(with: home(title: "Late response"))

        let result = await load.value
        XCTAssertEqual(result, .superseded)
        XCTAssertEqual(model.contentState(for: "guest"), .empty)
        XCTAssertTrue(model.rows.isEmpty)
        XCTAssertFalse(model.isLoading)
    }

    func testSessionScopeChangeClearsPersonalizedRowsBeforeReplacementRequest() async {
        let service = SequenceDiscoveryService([
            .success(home(title: "Continue watching")),
            .failure(URLError(.notConnectedToInternet))
        ])
        let model = HomeViewModel(discovery: service)

        model.prepareForSession(scope: "account-a")
        let accountLoad = await model.load(token: "account-token")
        XCTAssertEqual(accountLoad, .loaded)
        XCTAssertEqual(model.rows.first?.title, "Continue watching")

        model.prepareForSession(scope: "guest")
        XCTAssertTrue(model.rows.isEmpty)

        let guestLoad = await model.load(token: nil)
        XCTAssertEqual(guestLoad, .failed)
        XCTAssertTrue(model.rows.isEmpty)
    }

    func testFailedDiscoveryCanRetryWithoutAuthenticationTransition() async {
        let service = SequenceDiscoveryService([
            .failure(URLError(.notConnectedToInternet)),
            .success(home(title: "Recovered"))
        ])
        let model = HomeViewModel(discovery: service)

        model.prepareForSession(scope: "guest")
        let failedLoad = await model.load(token: nil)
        XCTAssertEqual(failedLoad, .failed)
        XCTAssertTrue(model.rows.isEmpty)
        XCTAssertNotNil(model.errorMessage)

        let recoveredLoad = await model.load(token: nil)
        XCTAssertEqual(recoveredLoad, .loaded)
        XCTAssertEqual(model.rows.first?.title, "Recovered")
        XCTAssertNil(model.errorMessage)
    }

    func testUnauthorizedAuthenticatedDiscoveryClearsRowsAndSignalsSessionInvalidation() async {
        let service = SequenceDiscoveryService([
            .success(home(title: "Private history")),
            .failure(APIClientError.server(status: 401, message: "Unauthorized"))
        ])
        let model = HomeViewModel(discovery: service)

        model.prepareForSession(scope: "account-a")
        let firstLoad = await model.load(token: "first-token")
        XCTAssertEqual(firstLoad, .loaded)
        XCTAssertFalse(model.rows.isEmpty)

        let revokedLoad = await model.load(token: "revoked-token")
        XCTAssertEqual(revokedLoad, .authenticationRejected)
        XCTAssertTrue(model.rows.isEmpty)
        XCTAssertNil(model.errorMessage)
    }
}

private final class SequenceDiscoveryService: DiscoveryServicing {
    private var results: [Result<DiscoveryHomeResponse, Error>]

    init(_ results: [Result<DiscoveryHomeResponse, Error>]) {
        self.results = results
    }

    func home(token: String?) async throws -> DiscoveryHomeResponse {
        guard !results.isEmpty else { throw APIClientError.invalidResponse }
        return try results.removeFirst().get()
    }
}

private func home(title: String) -> DiscoveryHomeResponse {
    DiscoveryHomeResponse(
        rows: [
            DiscoveryRow(
                key: "row",
                title: title,
                items: [
                    DiscoveryItem(
                        id: "video",
                        type: "VIDEO",
                        title: "Example",
                        href: "/watch/example",
                        kicker: "Video",
                        meta: nil
                    )
                ],
                availability: "AVAILABLE",
                nextCursor: nil
            )
        ]
    )
}

private func emptyHome() -> DiscoveryHomeResponse {
    DiscoveryHomeResponse(rows: ["EMPTY", "UNAVAILABLE"].map { availability in
        DiscoveryRow(
            key: availability, title: availability, items: [],
            availability: availability, nextCursor: nil
        )
    })
}

private actor SuspendedDiscoveryService: DiscoveryServicing {
    private var request: CheckedContinuation<DiscoveryHomeResponse, Error>?
    private var started: CheckedContinuation<Void, Never>?

    func home(token: String?) async throws -> DiscoveryHomeResponse {
        try await withCheckedThrowingContinuation { continuation in
            request = continuation
            started?.resume()
            started = nil
        }
    }

    func waitUntilRequested() async {
        if request != nil { return }
        await withCheckedContinuation { started = $0 }
    }

    func finish(with response: DiscoveryHomeResponse) {
        request?.resume(returning: response)
        request = nil
    }
}
