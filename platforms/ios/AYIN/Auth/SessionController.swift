import Combine
import Foundation

@MainActor
final class SessionController: ObservableObject {
    @Published private(set) var identity: AYINIdentity?
    @Published private(set) var mfaChallenge: MFAChallenge?
    @Published private(set) var isRestoring = true

    private(set) var token: String?
    private let store: SessionTokenStore
    private let auth: AuthService

    init(
        store: SessionTokenStore = KeychainSessionStore(),
        auth: AuthService = AuthService()
    ) {
        self.store = store
        self.auth = auth
    }

    var isAuthenticated: Bool { token != nil && identity != nil }

    func restore() async {
        defer { isRestoring = false }
        do {
            guard let stored = try store.read() else { return }
            let user = try await auth.identity(token: stored)
            token = stored
            identity = user
        } catch {
            try? store.clear()
            token = nil
            identity = nil
        }
    }

    func login(email: String, password: String) async throws {
        let result = try await auth.login(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
        if result.mfaRequired == true {
            guard let challengeToken = result.challengeToken else {
                throw APIClientError.invalidResponse
            }
            mfaChallenge = MFAChallenge(
                token: challengeToken,
                enrollmentRequired: result.enrollmentRequired == true
            )
            return
        }
        try accept(result)
    }

    func completeMFA(code: String) async throws {
        guard let challenge = mfaChallenge, !challenge.enrollmentRequired else {
            throw APIClientError.invalidResponse
        }
        let result = try await auth.completeMFA(challengeToken: challenge.token, code: code)
        try accept(result)
        mfaChallenge = nil
    }

    func cancelMFA() {
        mfaChallenge = nil
    }

    func logout() async {
        if let token { await auth.logout(token: token) }
        try? store.clear()
        self.token = nil
        identity = nil
        mfaChallenge = nil
    }

    private func accept(_ result: AuthResponse) throws {
        guard let sessionToken = result.sessionToken, let user = result.user else {
            throw APIClientError.invalidResponse
        }
        try store.save(sessionToken)
        token = sessionToken
        identity = user
    }
}
