import Foundation

enum PlaybackAccounting {
    static let maximumContinuousDeltaMs = 30_000

    static func watchedDeltaMs(
        previousPositionMs: Int?,
        currentPositionMs: Int
    ) -> Int {
        guard let previousPositionMs else { return 0 }
        let delta = currentPositionMs - previousPositionMs
        guard delta > 0, delta <= maximumContinuousDeltaMs else { return 0 }
        return delta
    }
}
