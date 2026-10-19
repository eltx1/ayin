import Foundation
import CoreFoundation
import CryptoKit

enum MobileBridgeError: String, Error { case invalidRequest, invalidConfig, unavailable, disabled, consentRequired, busy, rateLimited, timeout, unsupported }

struct MobileRuntimeConfig: Decodable {
    struct Versions: Decodable { let ios: String }
    struct Ads: Decodable {
        struct Toggle: Decodable { let enabled: Bool }
        struct Interstitial: Decodable { let enabled: Bool; let cooldownSeconds: Int; let maxPerSession: Int }
        struct Units: Decodable { let enabled: Bool; let bannerUnitId: String; let interstitialUnitId: String }
        struct Platforms: Decodable { let ios: Units }
        let enabled: Bool; let testMode: Bool; let audience: String
        let banner: Toggle; let interstitial: Interstitial; let platforms: Platforms
        let requestTimeoutMs: Int; let retryCount: Int; let retryBackoffMs: Int
    }
    struct Analytics: Decodable { let enabled: Bool }
    struct Notifications: Decodable { let enabled: Bool; let types: [String]; let richMedia: Bool }
    struct Web: Decodable {
        let mode: String; let origin: String; let minimumBridgeVersion: Int
        let rolloutPercent: Int; let bundleUpdatesEnabled: Bool
    }
    let schemaVersion: Int; let bridgeVersion: Int
    let minimumAppVersion: Versions; let latestAppVersion: Versions
    let ads: Ads; let analytics: Analytics; let notifications: Notifications; let web: Web

    static func parse(_ raw: Any) throws -> Self {
        guard JSONSerialization.isValidJSONObject(raw) else { throw MobileBridgeError.invalidConfig }
        let bytes = try JSONSerialization.data(withJSONObject: raw)
        guard bytes.count <= 32_768 else { throw MobileBridgeError.invalidConfig }
        let value = try JSONDecoder().decode(Self.self, from: bytes)
        guard value.schemaVersion == 1, value.bridgeVersion == 1,
              value.web.mode == "hosted", value.web.origin == "https://ayin.stream",
              value.web.minimumBridgeVersion <= 1, !value.web.bundleUpdatesEnabled,
              (0...100).contains(value.web.rolloutPercent),
              (60...3600).contains(value.ads.interstitial.cooldownSeconds),
              (0...20).contains(value.ads.interstitial.maxPerSession),
              (1000...30000).contains(value.ads.requestTimeoutMs),
              (0...3).contains(value.ads.retryCount), (500...30000).contains(value.ads.retryBackoffMs),
              ["unknown", "general", "children"].contains(value.ads.audience),
              validUnit(value.ads.platforms.ios.bannerUnitId), validUnit(value.ads.platforms.ios.interstitialUnitId),
              validVersion(value.minimumAppVersion.ios), validVersion(value.latestAppVersion.ios),
              value.notifications.types.count <= 7,
              Set(value.notifications.types).isSubset(of: ["system", "channel", "video", "comment", "subscription", "moderation", "monetization"]),
              Set(value.notifications.types).count == value.notifications.types.count, !value.notifications.richMedia
        else { throw MobileBridgeError.invalidConfig }
        let minimum = value.minimumAppVersion.ios.split(separator: ".").compactMap { Int($0) }
        let latest = value.latestAppVersion.ios.split(separator: ".").compactMap { Int($0) }
        guard !latest.lexicographicallyPrecedes(minimum),
              !value.ads.enabled || value.ads.audience == "general" else { throw MobileBridgeError.invalidConfig }
        if value.ads.enabled && value.ads.platforms.ios.enabled && !value.ads.testMode {
            guard !value.ads.banner.enabled || !value.ads.platforms.ios.bannerUnitId.isEmpty,
                  !value.ads.interstitial.enabled || !value.ads.platforms.ios.interstitialUnitId.isEmpty
            else { throw MobileBridgeError.invalidConfig }
        }
        return value
    }

    func supports(appVersion: String, installationId: String) -> Bool {
        !requiresUpgrade(appVersion: appVersion) && Self.rolloutBucket(installationId: installationId) < web.rolloutPercent
    }

    func requiresUpgrade(appVersion: String) -> Bool {
        let installed = appVersion.split(separator: ".").compactMap { Int($0) }
        let required = minimumAppVersion.ios.split(separator: ".").compactMap { Int($0) }
        guard installed.count == 3, required.count == 3,
              !installed.lexicographicallyPrecedes(required) else { return true }
        return false
    }

    static func rolloutBucket(installationId: String) -> Int {
        // Same cross-platform cohort: first four SHA-256 bytes as an unsigned big-endian integer.
        let first = SHA256.hash(data: Data(installationId.utf8)).prefix(4)
        return Int(first.reduce(UInt64(0)) { ($0 << 8) | UInt64($1) } % 100)
    }

    private static func validUnit(_ value: String) -> Bool {
        value.isEmpty || value.range(of: #"^ca-app-pub-[0-9]{16}/[0-9]{10}$"#, options: .regularExpression) != nil
    }
    private static func validVersion(_ value: String) -> Bool {
        value.range(of: #"^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$"#, options: .regularExpression) != nil
    }
}

enum MobileContract {
    static let capabilities = ["privacy", "analytics", "ads.banner", "ads.interstitial", "notifications", "session.reset"]
    static let methods: Set<String> = ["runtime.configure", "privacy.request", "privacy.options", "analytics.consent", "analytics.event", "analytics.user", "ads.banner", "ads.hideBanner", "ads.interstitial", "notifications.request", "notifications.token", "session.reset"]

    static func boolean(_ value: Any?) -> Bool? {
        guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
        return number.boolValue
    }

    static func trusted(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.scheme == "https" && url.host == "ayin.stream" && (url.port == nil || url.port == 443)
            && url.user == nil && url.password == nil
    }

    static func notificationRoute(_ raw: String) -> String? {
        guard raw.count <= 300, raw.hasPrefix("/"), !raw.hasPrefix("//"),
              !raw.contains("\\"), !raw.contains("%"), !raw.contains("?"), !raw.contains("#"),
              raw.range(of: #"^/(en/|ar/)?(watch|live|channel|clips)/[A-Za-z0-9_@.-]{1,160}$"#, options: .regularExpression) != nil
        else { return nil }
        return raw
    }

    static func event(_ name: String, params: [String: Any]) throws -> [String: Any] {
        let schemas: [String: Set<String>] = [
            "screen_view": ["screen_name"], "video_start": ["content_type"],
            "video_progress": ["content_type", "position_seconds"], "video_complete": ["content_type"],
            "clip_view": ["content_type"], "share": ["content_type"], "search": ["query_length"], "follow": [],
            "upload_started": ["size_bucket"], "upload_resumed": ["size_bucket"],
            "upload_completed": ["size_bucket"], "upload_failed": ["size_bucket"]
        ]
        guard let keys = schemas[name], Set(params.keys) == keys else { throw MobileBridgeError.invalidRequest }
        for (key, value) in params {
            switch key {
            case "screen_name":
                guard let value = value as? String, ["home", "watch", "clips", "search", "channel", "account", "upload", "other"].contains(value) else { throw MobileBridgeError.invalidRequest }
            case "content_type":
                guard let value = value as? String, ["video", "clip"].contains(value) else { throw MobileBridgeError.invalidRequest }
                if name == "video_progress" && value != "video" { throw MobileBridgeError.invalidRequest }
            case "size_bucket":
                guard let value = value as? String, ["small", "medium", "large", "unknown"].contains(value) else { throw MobileBridgeError.invalidRequest }
            case "query_length", "position_seconds":
                guard let value = value as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(), value.doubleValue.isFinite,
                      value.doubleValue >= 0, value.doubleValue <= (key == "query_length" ? 200 : 86_400)
                else { throw MobileBridgeError.invalidRequest }
            default: throw MobileBridgeError.invalidRequest
            }
        }
        return params
    }
}
