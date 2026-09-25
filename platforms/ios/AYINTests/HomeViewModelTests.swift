import XCTest
@testable import AYIN

@MainActor
final class HomeViewModelTests: XCTestCase {
    func testSessionScopeChangeClearsPersonalizedRowsBeforeReplacementRequest() async {
        let service = SequenceDiscoveryService([
            .success(home(title: "Continue watching")),
            .failure(URLError(.notConnectedToInternet))
        ])
        let model = HomeViewModel(discovery: service)

        model.prepareForSession(scope: "account-a")
        XCTAssertEqual(await model.load(token: "account-token"), .loaded)
        XCTAssertEqual(model.rows.first?.title, "Continue watching")

        model.prepareForSession(scope: "guest")
        XCTAssertTrue(model.rows.isEmpty)

        XCTAssertEqual(await model.load(token: nil), .failed)
        XCTAssertTrue(model.rows.isEmpty)
    }

    func testUnauthorizedAuthenticatedDiscoveryClearsRowsAndSignalsSessionInvalidation() async {
        let service = SequenceDiscoveryService([
            .success(home(title: "Private history")),
            .failure(APIClientError.server(status: 401, message: "Unauthorized"))
        ])
        let model = HomeViewModel(discovery: service)

        model.prepareForSession(scope: "account-a")
        XCTAssertEqual(await model.load(token: "first-token"), .loaded)
        XCTAssertFalse(model.rows.isEmpty)

        XCTAssertEqual(await model.load(token: "revoked-token"), .authenticationRejected)
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
                availability: "AVAILABLE"
            )
        ]
    )
}
