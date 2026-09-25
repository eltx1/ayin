import Combine
import Foundation

enum HomeLoadResult: Equatable {
    case loaded
    case authenticationRejected
    case failed
    case superseded
}

@MainActor
final class HomeViewModel: ObservableObject {
    @Published private(set) var rows: [DiscoveryRow] = []
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?

    private let discovery: any DiscoveryServicing
    private var sessionScope: String?
    private var generation = 0
    private var requestSequence = 0

    init(discovery: any DiscoveryServicing = DiscoveryService()) {
        self.discovery = discovery
    }

    func prepareForSession(scope: String) {
        guard scope != sessionScope else { return }
        sessionScope = scope
        generation += 1
        requestSequence += 1
        rows = []
        errorMessage = nil
        isLoading = false
    }

    @discardableResult
    func load(token: String?) async -> HomeLoadResult {
        let requestGeneration = generation
        requestSequence += 1
        let requestID = requestSequence
        isLoading = true
        defer {
            if requestGeneration == generation, requestID == requestSequence {
                isLoading = false
            }
        }

        do {
            let response = try await discovery.home(token: token)
            guard requestGeneration == generation, requestID == requestSequence, !Task.isCancelled else {
                return .superseded
            }
            rows = response.rows
            errorMessage = nil
            return .loaded
        } catch let error as APIClientError where error.statusCode == 401 {
            guard requestGeneration == generation, requestID == requestSequence, !Task.isCancelled else {
                return .superseded
            }
            rows = []
            errorMessage = nil
            return .authenticationRejected
        } catch {
            guard requestGeneration == generation, requestID == requestSequence, !Task.isCancelled else {
                return .superseded
            }
            errorMessage = error.localizedDescription
            return .failed
        }
    }
}
