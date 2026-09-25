import Foundation

enum AppEnvironment {
    static let apiBaseURL = requiredHTTPSURL(for: "AYINAPIBaseURL")
    static let mediaBaseURL = requiredHTTPSURL(for: "AYINMediaBaseURL")
    static let webBaseURL = requiredHTTPSURL(for: "AYINWebBaseURL")

    private static func requiredHTTPSURL(for key: String) -> URL {
        guard
            let raw = Bundle.main.object(forInfoDictionaryKey: key) as? String,
            let url = URL(string: raw),
            url.scheme == "https",
            url.host != nil
        else {
            preconditionFailure("Missing or insecure iOS configuration for \(key)")
        }
        return url
    }
}
