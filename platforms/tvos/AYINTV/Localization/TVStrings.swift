import Foundation

// SwiftUI localizes literal labels. UIKit titles and values assembled as String
// need an explicit lookup. The app bundle follows the system's app language;
// language bundles can be injected in tests without changing app preferences.
enum TVStrings {
    static func text(_ key: String, bundle: Bundle = .main) -> String {
        NSLocalizedString(key, bundle: bundle, comment: "Existing native tvOS control")
    }

    static func moreTitle(isLoading: Bool, bundle: Bundle = .main) -> String {
        text(isLoading ? "Loading…" : "More", bundle: bundle)
    }

    static func moreResultsTitle(isLoading: Bool, bundle: Bundle = .main) -> String {
        text(isLoading ? "Loading…" : "More Results", bundle: bundle)
    }

    static func searchPrompt(isKids: Bool, bundle: Bundle = .main) -> String {
        text(isKids ? "Search Kids on AYIN" : "Movies, series, creators, videos", bundle: bundle)
    }

    static func progressReviewTitle(isReviewing: Bool, bundle: Bundle = .main) -> String {
        text(isReviewing ? "Reviewing…" : "Review saved progress", bundle: bundle)
    }

    static func playbackFailureMessage(_ message: String?, bundle: Bundle = .main) -> String {
        // Server and system error messages remain owned by their source.
        message ?? text("AYIN could not start this title.", bundle: bundle)
    }

    static func videoDescription(protocolName: String, bundle: Bundle = .main) -> String {
        text(protocolName == "HLS" ? "Adaptive HLS playback" : "Video", bundle: bundle)
    }

    static func creatorTVDescription(state: String, status: String, bundle: Bundle = .main) -> String {
        state == "ON_AIR" ? text("On Air", bundle: bundle) : status
    }

    static func seasonTitle(_ title: String?, number: Int, bundle: Bundle = .main) -> String {
        title ?? String(format: text("Season %d", bundle: bundle), number)
    }

    static func movieMetadata(year: Int, rating: String, minutes: Int, bundle: Bundle = .main) -> String {
        // Server-owned ratings are arguments, never localization keys or formats.
        String(format: text("%d · %@ · %d min", bundle: bundle), year, rating, minutes)
    }

    static func resumePosition(_ milliseconds: Int, bundle: Bundle = .main) -> String {
        let seconds = max(0, milliseconds / 1_000)
        let hours = seconds / 3_600
        let minutes = (seconds % 3_600) / 60
        let remainingSeconds = seconds % 60
        if hours > 0 {
            return String(format: text("%d:%02d:%02d watched", bundle: bundle), hours, minutes, remainingSeconds)
        }
        return String(format: text("%d:%02d watched", bundle: bundle), minutes, remainingSeconds)
    }
}
