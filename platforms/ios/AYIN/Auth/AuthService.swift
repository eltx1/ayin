import Foundation

protocol AuthServicing {
    func login(email: String, password: String) async throws -> AuthResponse
    func completeMFA(challengeToken: String, code: String) async throws -> AuthResponse
    func identity(token: String) async throws -> AYINIdentity
    func logout(token: String) async
}

struct AuthService: AuthServicing {
    private let client: APIClient

    init(client: APIClient = APIClient(baseURL: AppEnvironment.apiBaseURL)) {
        self.client = client
    }

    func login(email: String, password: String) async throws -> AuthResponse {
        try await client.request(
            "/auth/login",
            method: "POST",
            body: LoginRequest(email: email, password: password),
            headers: ["X-Ayin-Auth-Transport": "bearer"]
        )
    }

    func completeMFA(challengeToken: String, code: String) async throws -> AuthResponse {
        try await client.request(
            "/auth/mfa/challenge",
            method: "POST",
            body: MFARequest(challengeToken: challengeToken, code: code),
            headers: ["X-Ayin-Auth-Transport": "bearer"]
        )
    }

    func identity(token: String) async throws -> AYINIdentity {
        try await client.request("/auth/me", token: token)
    }

    func logout(token: String) async {
        try? await client.requestNoContent("/auth/logout", method: "POST", token: token)
    }
}
