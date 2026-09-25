import Foundation

struct PlaybackCheckpoint: Equatable {
    let positionMs: Int
    let forceProgressSave: Bool
}

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

    static func coalescedCheckpoint(
        existing: PlaybackCheckpoint?,
        positionMs: Int,
        forceProgressSave: Bool
    ) -> PlaybackCheckpoint {
        PlaybackCheckpoint(
            positionMs: max(0, positionMs),
            forceProgressSave: forceProgressSave || (existing?.forceProgressSave ?? false)
        )
    }
}
