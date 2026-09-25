import Foundation

enum APIClientError: LocalizedError {
    case invalidResponse
    case server(status: Int, message: String)
    case invalidURL

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "AYIN returned an invalid response."
        case let .server(_, message):
            return message
        case .invalidURL:
            return "AYIN could not build a secure request URL."
        }
    }
}

struct APIClient {
    let baseURL: URL
    var session: URLSession = .shared

    func request<Response: Decodable>(
        _ path: String,
        method: String = "GET",
        token: String? = nil,
        body: Encodable? = nil,
        headers: [String: String] = [:]
    ) async throws -> Response {
        guard let url = URL(string: path, relativeTo: baseURL), url.scheme == "https" else {
            throw APIClientError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        for (name, value) in headers {
            request.setValue(value, forHTTPHeaderField: name)
        }
        if let body {
            request.httpBody = try JSONEncoder().encode(AnyEncodable(body))
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let envelope = try? JSONDecoder().decode(APIErrorEnvelope.self, from: data)
            throw APIClientError.server(
                status: http.statusCode,
                message: envelope?.error?.message ?? envelope?.message ?? "AYIN request failed."
            )
        }
        return try JSONDecoder().decode(Response.self, from: data)
    }

    func requestNoContent(
        _ path: String,
        method: String,
        token: String?
    ) async throws {
        guard let url = URL(string: path, relativeTo: baseURL), url.scheme == "https" else {
            throw APIClientError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw APIClientError.server(status: http.statusCode, message: "AYIN request failed.")
        }
    }
}

private struct APIErrorEnvelope: Decodable {
    struct APIError: Decodable { let message: String? }
    let error: APIError?
    let message: String?
}

private struct AnyEncodable: Encodable {
    private let encodeClosure: (Encoder) throws -> Void

    init(_ value: Encodable) {
        self.encodeClosure = value.encode(to:)
    }

    func encode(to encoder: Encoder) throws {
        try encodeClosure(encoder)
    }
}
