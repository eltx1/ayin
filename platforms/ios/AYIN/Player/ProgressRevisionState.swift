import Foundation

/// A checkpoint needs a current read and one matching acknowledgment. Failures
/// pause persistence until the user explicitly reviews the server's current state.
struct ProgressRevisionState {
    struct Ticket: Equatable {
        fileprivate let sequence: UInt64
        let expectedRevision: String?
    }

    private var sequence: UInt64 = 0
    private var pending: Ticket?
    private(set) var snapshot: WatchProgress?
    private(set) var requiresReview = false

    mutating func reset() {
        sequence &+= 1
        pending = nil
        snapshot = nil
        requiresReview = false
    }

    mutating func beginRead() -> Ticket {
        sequence &+= 1
        let ticket = Ticket(sequence: sequence, expectedRevision: nil)
        pending = ticket
        snapshot = nil
        return ticket
    }

    // TV may explicitly seek backward against a known revision. This never bypasses
    // the current-read, one-pending-write, or post-failure review requirements.
    mutating func beginSave(positionMs: Int, allowsBackward: Bool = false) -> Ticket? {
        guard pending == nil, !requiresReview, let snapshot,
              allowsBackward || positionMs >= snapshot.positionMs else { return nil }
        sequence &+= 1
        let ticket = Ticket(sequence: sequence, expectedRevision: snapshot.revision)
        pending = ticket
        return ticket
    }

    @discardableResult
    mutating func accept(_ progress: WatchProgress, for ticket: Ticket) -> Bool {
        guard pending == ticket else { return false }
        pending = nil
        snapshot = progress
        requiresReview = false
        return true
    }

    @discardableResult
    mutating func fail(_ ticket: Ticket) -> Bool {
        guard pending == ticket else { return false }
        pending = nil
        snapshot = nil
        requiresReview = true
        return true
    }
}
