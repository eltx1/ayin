import XCTest
@testable import AYIN

@MainActor
final class SessionControllerTests: XCTestCase {
    func testLoginIsBlockedWhileRestorationIsInProgress() async {
        let store = MockSessionTokenStore()
        let auth = MockAuthService()
        let controller = SessionController(store: store, auth: auth)

        do {
            try await controller.login(email: "viewer@example.com", password: "password")
            XCTFail("Login should be blocked while restore is pending")
        } catch {
            XCTAssertEqual(error as? SessionControllerError, .restorationInProgress)
        }
        XCTAssertEqual(auth.loginCalls, 0)
    }

    func testTransientRestoreFailurePreservesStoredSession() async {
        let store = MockSessionTokenStore(token: "stored-token")
        let auth = MockAuthService()
        auth.identityError = URLError(.notConnectedToInternet)
        let controller = SessionController(store: store, auth: auth)

        await controller.restore()

        XCTAssertEqual(store.token, "stored-token")
        XCTAssertEqual(controller.token, "stored-token")
        XCTAssertNil(controller.identity)
        XCTAssertNotNil(controller.restoreErrorMessage)
        XCTAssertFalse(controller.isRestoring)
    }

    func testUnauthorizedRestoreClearsStoredSession() async {
        let store = MockSessionTokenStore(token: "revoked-token")
        let auth = MockAuthService()
        auth.identityError = APIClientError.server(status: 401, message: "Unauthorized")
        let controller = SessionController(store: store, auth: auth)

        await controller.restore()

        XCTAssertNil(store.token)
        XCTAssertNil(controller.token)
        XCTAssertNil(controller.identity)
        XCTAssertNil(controller.restoreErrorMessage)
    }

    func testRecoveryCodeCompletesMFAWithoutAuthenticatorCode() async throws {
        let store = MockSessionTokenStore()
        let auth = MockAuthService()
        auth.loginResponse = AuthResponse(
            sessionToken: nil,
            user: nil,
            mfaRequired: true,
            enrollmentRequired: false,
            challengeToken: "challenge-token"
        )
        auth.mfaResponse = AuthResponse(
            sessionToken: "new-session",
            user: sampleIdentity,
            mfaRequired: nil,
            enrollmentRequired: nil,
            challengeToken: nil
        )
        let controller = SessionController(store: store, auth: auth)
        await controller.restore()

        try await controller.login(email: "viewer@example.com", password: "password")
        try await controller.completeMFA(recoveryCode: "RECOVERY-CODE-1234")

        XCTAssertEqual(auth.lastMFAChallengeToken, "challenge-token")
        XCTAssertNil(auth.lastMFACode)
        XCTAssertEqual(auth.lastMFARecoveryCode, "RECOVERY-CODE-1234")
        XCTAssertEqual(store.token, "new-session")
        XCTAssertTrue(controller.isAuthenticated)
    }

    func testLocalInvalidationClearsIdentityAndTokenImmediately() async throws {
        let store = MockSessionTokenStore(token: "valid-token")
        let auth = MockAuthService()
        auth.identityValue = sampleIdentity
        let controller = SessionController(store: store, auth: auth)
        await controller.restore()
        XCTAssertTrue(controller.isAuthenticated)

        controller.invalidateLocalSession()

        XCTAssertFalse(controller.isAuthenticated)
        XCTAssertNil(controller.token)
        XCTAssertNil(controller.identity)
        XCTAssertNil(store.token)
    }
}

private final class MockSessionTokenStore: SessionTokenStore {
    var token: String?

    init(token: String? = nil) {
        self.token = token
    }

    func read() throws -> String? { token }

    func save(_ token: String) throws {
        self.token = token
    }

    func clear() throws {
        token = nil
    }
}

private final class MockAuthService: AuthServicing {
    var identityValue: AYINIdentity?
    var identityError: Error?
    var loginResponse: AuthResponse?
    var mfaResponse: AuthResponse?
    var loginCalls = 0
    var lastMFAChallengeToken: String?
    var lastMFACode: String?
    var lastMFARecoveryCode: String?

    func login(email: String, password: String) async throws -> AuthResponse {
        loginCalls += 1
        if let loginResponse { return loginResponse }
        throw APIClientError.invalidResponse
    }

    func completeMFA(
        challengeToken: String,
        code: String?,
        recoveryCode: String?
    ) async throws -> AuthResponse {
        lastMFAChallengeToken = challengeToken
        lastMFACode = code
        lastMFARecoveryCode = recoveryCode
        if let mfaResponse { return mfaResponse }
        throw APIClientError.invalidResponse
    }

    func identity(token: String) async throws -> AYINIdentity {
        if let identityError { throw identityError }
        guard let identityValue else { throw APIClientError.invalidResponse }
        return identityValue
    }

    func logout(token: String) async {}
}

private let sampleIdentity = AYINIdentity(
    account: .init(displayName: "Viewer", email: "viewer@example.com", id: "account"),
    channel: .init(handle: "viewer", id: "channel", name: "Viewer"),
    creatorTv: .init(id: "tv", name: "Viewer TV", slug: "viewer-tv"),
    profile: .init(id: "profile", name: "Viewer", slug: "viewer")
)
