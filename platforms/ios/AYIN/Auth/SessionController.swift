import Combine
import Foundation

enum SessionControllerError: LocalizedError, Equatable {
    case restorationInProgress
    case invalidMFAInput

    var errorDescription: String? {
        switch self {
        case .restorationInProgress:
            return "AYIN is still restoring your session. Try again in a moment."
        case .invalidMFAInput:
            return "Enter either an authenticator code or a recovery code."
        }
    }
}

@MainActor
final class SessionController: ObservableObject {
    @Published private(set) var identity: AYINIdentity?
    @Published private(set) var mfaChallenge: MFAChallenge?
    @Published private(set) var isRestoring = true
    @Published private(set) var restoreErrorMessage: String?

    private(set) var token: String?
    private let store: SessionTokenStore
    private let auth: any AuthServicing

    init(
        store: SessionTokenStore = KeychainSessionStore(),
        auth: any AuthServicing = AuthService()
    ) {
        self.store = store
        self.auth = auth
    }

    var isAuthenticated: Bool { token != nil && identity != nil }

    func restore() async {
        isRestoring = true
        restoreErrorMessage = nil
        defer { isRestoring = false }

        let stored: String
        do {
            guard let value = try store.read() else {
                token = nil
                identity = nil
                return
            }
            stored = value
            token = value
        } catch {
            token = nil
            identity = nil
            restoreErrorMessage = error.localizedDescription
            return
        }

        do {
            identity = try await auth.identity(token: stored)
        } catch let error as APIClientError where error.statusCode == 401 {
            invalidateLocalSession()
        } catch {
            // Connectivity, server and decoding failures do not invalidate a server session.
            // Keep the opaque token in Keychain so the user can retry restoration later.
            identity = nil
            restoreErrorMessage = error.localizedDescription
        }
    }

    func retryRestore() async {
        guard !isRestoring else { return }
        await restore()
    }

    func login(email: String, password: String) async throws {
        guard !isRestoring else { throw SessionControllerError.restorationInProgress }

        let result = try await auth.login(
            email: email.trimmingCharacters(in: .whitespacesAndNewlines),
            password: password
        )
        try Task.checkCancellation()
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

    func completeMFA(code: String? = nil, recoveryCode: String? = nil) async throws {
        guard !isRestoring else { throw SessionControllerError.restorationInProgress }
        guard let challenge = mfaChallenge, !challenge.enrollmentRequired else {
            throw APIClientError.invalidResponse
        }

        let normalizedCode = code?.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedRecoveryCode = recoveryCode?.trimmingCharacters(in: .whitespacesAndNewlines)
        let hasCode = !(normalizedCode?.isEmpty ?? true)
        let hasRecoveryCode = !(normalizedRecoveryCode?.isEmpty ?? true)
        guard hasCode != hasRecoveryCode else {
            throw SessionControllerError.invalidMFAInput
        }

        let result = try await auth.completeMFA(
            challengeToken: challenge.token,
            code: hasCode ? normalizedCode : nil,
            recoveryCode: hasRecoveryCode ? normalizedRecoveryCode : nil
        )
        try Task.checkCancellation()
        try accept(result)
        mfaChallenge = nil
    }

    func cancelMFA() {
        mfaChallenge = nil
    }

    func logout() async {
        let currentToken = token
        invalidateLocalSession()
        if let currentToken { await auth.logout(token: currentToken) }
    }

    func invalidateLocalSession() {
        try? store.clear()
        token = nil
        identity = nil
        mfaChallenge = nil
        restoreErrorMessage = nil
    }

    private func accept(_ result: AuthResponse) throws {
        guard let sessionToken = result.sessionToken, let user = result.user else {
            throw APIClientError.invalidResponse
        }
        try store.save(sessionToken)
        token = sessionToken
        identity = user
        restoreErrorMessage = nil
    }
}
