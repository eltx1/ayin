import Foundation

// SwiftUI localizes literal labels automatically, but labels assembled as String
// values need an explicit lookup. Bundle.main follows the system's app language;
// an injected language bundle lets tests verify both supported localizations.
enum NativeStrings {
    static func discoverySearchTitle(isKids: Bool, bundle: Bundle = .main) -> String {
        NSLocalizedString(isKids ? "Browse Kids on web" : "Search on web", bundle: bundle, comment: "Web discovery action")
    }

    static func discoveryBrowseTitle(isKids: Bool, bundle: Bundle = .main) -> String {
        NSLocalizedString(isKids ? "Browse Kids on web" : "Browse more on web", bundle: bundle, comment: "Web catalog action")
    }

    static func webSessionNotice(canOpen: Bool, bundle: Bundle = .main) -> String {
        NSLocalizedString(canOpen
            ? "Web sign-in is separate from this app. Available rows may differ."
            : "Sign in or retry your saved session before opening Web discovery.",
            bundle: bundle, comment: "Web session boundary")
    }

    static func discoveryBrowseHint(isKids: Bool, bundle: Bundle = .main) -> String {
        NSLocalizedString(isKids
            ? "Opens the Web Kids catalog, where available rows have Load more controls."
            : "Opens Web Home, where available rows have Load more controls.",
            bundle: bundle, comment: "Web catalog accessibility hint")
    }

    static func browseMoreAccessibilityLabel(rowTitle: String, bundle: Bundle = .main) -> String {
        let format = NSLocalizedString("Browse more from %@ on the web", bundle: bundle, comment: "%@ is the server-provided row title")
        return String(format: format, rowTitle)
    }

    static func progressReviewTitle(isReviewing: Bool, bundle: Bundle = .main) -> String {
        NSLocalizedString(isReviewing ? "Reviewing…" : "Review saved progress", bundle: bundle, comment: "Saved progress review action")
    }

    static func openOnWebTitle(isOpening: Bool, bundle: Bundle = .main) -> String {
        NSLocalizedString(isOpening ? "Opening…" : "Open on web", bundle: bundle, comment: "Continue playback on web")
    }

    static func playbackFailureMessage(_ message: String?, bundle: Bundle = .main) -> String {
        // Server and system error messages remain owned by their source.
        message ?? NSLocalizedString("AYIN could not start this video.", bundle: bundle, comment: "Playback fallback error")
    }
}
