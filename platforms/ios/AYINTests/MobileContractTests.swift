import XCTest
@testable import AYIN

final class MobileContractTests: XCTestCase {
    private func fixture() throws -> [String: Any] {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "mobile-runtime-v1", withExtension: "json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }

    func testOnlyExactProductionHTTPSOriginIsTrusted() {
        XCTAssertTrue(MobileContract.trusted(URL(string: "https://ayin.stream/watch/hello")))
        XCTAssertTrue(MobileContract.trusted(URL(string: "https://ayin.stream:443/")))
        for raw in ["https://ayin.stream.evil.example/", "https://evil.ayin.stream/", "http://ayin.stream/", "https://ayin.stream:8443/", "https://user@ayin.stream/", "file:///ayin.stream/index.html", "javascript:alert(1)", "https://ayin.stream@evil.example/"] {
            XCTAssertFalse(MobileContract.trusted(URL(string: raw)), raw)
        }
        XCTAssertFalse(MobileContract.trusted(nil))
    }

    func testConfigDefaultsDisableOptionalSDKFeatures() throws {
        let config = try MobileRuntimeConfig.parse(fixture())
        XCTAssertFalse(config.ads.enabled)
        XCTAssertFalse(config.analytics.enabled)
        XCTAssertFalse(config.notifications.enabled)
        XCTAssertFalse(config.web.bundleUpdatesEnabled)
        XCTAssertTrue(config.supports(appVersion: "1.0.0", installationId: "937d94a8-c40f-4806-ac42-c059cc801063"))
    }

    func testRemoteConfigCannotChangeTrustedOriginOrInstallBundles() throws {
        for mutation: [String: Any] in [["origin": "https://evil.example"], ["bundleUpdatesEnabled": true], ["minimumBridgeVersion": 2], ["minimumBridgeVersion": 0], ["minimumBridgeVersion": -1], ["mode": "bundle"]] {
            var raw = try fixture()
            var web = try XCTUnwrap(raw["web"] as? [String: Any])
            mutation.forEach { web[$0.key] = $0.value }
            raw["web"] = web
            XCTAssertThrowsError(try MobileRuntimeConfig.parse(raw))
        }
    }

    func testConfigRejectsUnknownAndMissingKeysAtEveryObjectDepth() throws {
        let paths = [[], ["minimumAppVersion"], ["latestAppVersion"], ["ads"], ["ads", "banner"],
                     ["ads", "interstitial"], ["ads", "platforms"], ["ads", "platforms", "ios"],
                     ["ads", "platforms", "android"], ["analytics"], ["notifications"], ["web"]]
        func changing(_ value: [String: Any], path: [String], remove: Bool) -> [String: Any] {
            var output = value
            if let first = path.first, let child = output[first] as? [String: Any] {
                output[first] = changing(child, path: Array(path.dropFirst()), remove: remove)
            } else if remove {
                if let key = output.keys.sorted().first { output.removeValue(forKey: key) }
            } else { output["unexpected"] = "reject" }
            return output
        }
        for path in paths {
            XCTAssertThrowsError(try MobileRuntimeConfig.parse(changing(fixture(), path: path, remove: false)), path.joined(separator: "."))
            XCTAssertThrowsError(try MobileRuntimeConfig.parse(changing(fixture(), path: path, remove: true)), path.joined(separator: "."))
        }
    }

    func testRejectsFutureSchemaAndStringBooleans() throws {
        var raw = try fixture(); raw["schemaVersion"] = 2
        XCTAssertThrowsError(try MobileRuntimeConfig.parse(raw))
        raw = try fixture(); raw["analytics"] = ["enabled": "true"]
        XCTAssertThrowsError(try MobileRuntimeConfig.parse(raw))
        raw = try fixture(); raw["latestAppVersion"] = ["ios": "1.1.0", "android": 123]
        XCTAssertThrowsError(try MobileRuntimeConfig.parse(raw))
    }

    func testRejectsUnsafeAdLimits() throws {
        for mutation: [String: Any] in [["requestTimeoutMs": 0], ["retryCount": 50], ["retryBackoffMs": -1], ["audience": "guess"]] {
            var raw = try fixture()
            var ads = try XCTUnwrap(raw["ads"] as? [String: Any])
            mutation.forEach { ads[$0.key] = $0.value }; raw["ads"] = ads
            XCTAssertThrowsError(try MobileRuntimeConfig.parse(raw))
        }
    }

    func testAdManagerPathsAndAdMobUnitsAreAcceptedByConfig() throws {
        for unit in ["/21775744923/example/adaptive-banner", "/123/ayin/ios.interstitial-1", "ca-app-pub-3940256099942544/2435281174", ""] {
            var raw = try fixture()
            var ads = try XCTUnwrap(raw["ads"] as? [String: Any])
            let placement: [String: Any] = ["enabled": false, "bannerUnitId": unit, "interstitialUnitId": unit]
            ads["platforms"] = ["ios": placement, "android": placement]; raw["ads"] = ads
            XCTAssertNoThrow(try MobileRuntimeConfig.parse(raw), unit)
        }
        XCTAssertTrue(MobileContract.capabilities.contains("ads.gam"))
    }

    func testAdUnitsRejectMalformedPathsAndUnboundedInput() {
        for unit in ["/123", "/123/", "/123//banner", "/abc/banner", "/123/banner?x=1", "/123/banner#x", "https://ads.example/unit", "/123/banner\n", "/123/my banner", "/123/%2Fbanner", "/123/<banner>", "/123456789012345678901/banner", "/123/" + String(repeating: "x", count: 252), "ca-app-pub-3940256099942544/2435281174\n"] {
            XCTAssertFalse(MobileAdInventory.validUnit(unit), unit)
        }
        XCTAssertTrue(MobileAdInventory.validUnit("/123/" + String(repeating: "x", count: 251)))
    }

    func testTestInventoryFollowsEachPlacementsProvider() {
        let gam = "/123/ayin/banner"
        let admob = "ca-app-pub-1234567890123456/1234567890"
        XCTAssertEqual(MobileAdInventory.unit(configured: gam, banner: true, testMode: true), "/21775744923/example/adaptive-banner")
        XCTAssertEqual(MobileAdInventory.unit(configured: gam, banner: false, testMode: true), "/21775744923/example/interstitial")
        XCTAssertEqual(MobileAdInventory.unit(configured: admob, banner: true, testMode: true), "ca-app-pub-3940256099942544/2435281174")
        XCTAssertEqual(MobileAdInventory.unit(configured: admob, banner: false, testMode: true), "ca-app-pub-3940256099942544/4411468910")
        XCTAssertEqual(MobileAdInventory.unit(configured: gam, banner: true, testMode: false), gam)
        XCTAssertEqual(MobileAdInventory.unit(configured: admob, banner: false, testMode: false), admob)
        XCTAssertNil(MobileAdInventory.unit(configured: "", banner: true, testMode: false))
        XCTAssertNil(MobileAdInventory.unit(configured: "/bad", banner: true, testMode: true))
    }

    func testRejectsRichNotificationsWithoutNativeExtension() throws {
        var raw = try fixture()
        var notifications = try XCTUnwrap(raw["notifications"] as? [String: Any])
        notifications["richMedia"] = true; raw["notifications"] = notifications
        XCTAssertThrowsError(try MobileRuntimeConfig.parse(raw))
    }

    func testMinimumVersionUsesNumericSegments() throws {
        var raw = try fixture(); raw["minimumAppVersion"] = ["ios": "1.9.0", "android": "1.0.0"]
        raw["latestAppVersion"] = ["ios": "1.10.0", "android": "1.1.0"]
        let config = try MobileRuntimeConfig.parse(raw)
        XCTAssertTrue(config.supports(appVersion: "1.10.0", installationId: "stable"))
        XCTAssertFalse(config.supports(appVersion: "1.8.99", installationId: "stable"))
        XCTAssertFalse(config.supports(appVersion: "broken", installationId: "stable"))
        XCTAssertFalse(config.requiresUpgrade(appVersion: "1.10.0"))
        XCTAssertTrue(config.requiresUpgrade(appVersion: "1.8.99"))
    }

    func testZeroRolloutDisablesRuntimeAndCohortIsStable() throws {
        var raw = try fixture(); var web = try XCTUnwrap(raw["web"] as? [String: Any])
        web["rolloutPercent"] = 0; raw["web"] = web
        XCTAssertFalse(try MobileRuntimeConfig.parse(raw).supports(appVersion: "1.0.0", installationId: "stable"))
        XCTAssertFalse(try MobileRuntimeConfig.parse(raw).requiresUpgrade(appVersion: "1.0.0"))
        web["rolloutPercent"] = 50; raw["web"] = web
        let config = try MobileRuntimeConfig.parse(raw)
        let first = config.supports(appVersion: "1.0.0", installationId: "937d94a8-c40f-4806-ac42-c059cc801063")
        for _ in 0..<10 { XCTAssertEqual(config.supports(appVersion: "1.0.0", installationId: "937d94a8-c40f-4806-ac42-c059cc801063"), first) }
        XCTAssertEqual(MobileRuntimeConfig.rolloutBucket(installationId: "937d94a8-c40f-4806-ac42-c059cc801063"), 56)
        XCTAssertEqual(MobileRuntimeConfig.rolloutBucket(installationId: "stable"), 53)
    }

    func testAnalyticsAllowsBoundedEventsWithoutPII() throws {
        XCTAssertEqual(try MobileContract.event("screen_view", params: ["screen_name": "watch"])["screen_name"] as? String, "watch")
        XCTAssertNoThrow(try MobileContract.event("search", params: ["query_length": 100]))
        XCTAssertNoThrow(try MobileContract.event("upload_failed", params: ["size_bucket": "large"]))
        XCTAssertNoThrow(try MobileContract.event("follow", params: [:]))
    }

    func testAnalyticsRejectsFreeTextURLsAndReservedSDKEvents() {
        for (event, params) in [("search", ["search_term": "private email@example.com"]), ("screen_view", ["screen_name": "/watch/private?token=secret"]), ("follow", ["email": "private@example.com"]), ("ad_impression", ["value": "1"]), ("session_start", [:])] {
            XCTAssertThrowsError(try MobileContract.event(event, params: params))
        }
        XCTAssertThrowsError(try MobileContract.event("video_progress", params: ["position_seconds": Double.infinity]))
        XCTAssertThrowsError(try MobileContract.event("search", params: ["query_length": true]))
        XCTAssertThrowsError(try MobileContract.event("search", params: ["query_length": 201]))
        XCTAssertThrowsError(try MobileContract.event("upload_started", params: ["size_bucket": "user@example.com"]))
        XCTAssertThrowsError(try MobileContract.event("screen_view", params: [:]))
        XCTAssertThrowsError(try MobileContract.event("video_progress", params: ["content_type": "clip", "position_seconds": 4]))
    }

    func testBrowseTransitionPayloadPassesNativeAdDispatchValidation() throws {
        // Exact payload emitted by requestBrowseInterstitial in the web runtime.
        let data = Data(#"{"placement":"browse_transition","naturalTransition":true}"#.utf8)
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertNoThrow(try MobileContract.validateAdRequest(payload, interstitial: true))
        XCTAssertNoThrow(try MobileContract.validateAdRequest(["placement": "browse_bottom"], interstitial: false))
        let mutations: [[String: Any]] = [["naturalTransition": false], ["naturalTransition": 1], ["naturalTransition": "true"], ["placement": "unknown"], ["placement": "/watch/private"], ["placement": 1], ["extra": true]]
        for mutation in mutations {
            var invalid = payload
            mutation.forEach { invalid[$0.key] = $0.value }
            XCTAssertThrowsError(try MobileContract.validateAdRequest(invalid, interstitial: true))
        }
        XCTAssertThrowsError(try MobileContract.validateAdRequest(["placement": "browse_transition"], interstitial: true))
        XCTAssertThrowsError(try MobileContract.validateAdRequest(["naturalTransition": true], interstitial: true))
        XCTAssertThrowsError(try MobileContract.validateAdRequest(payload, interstitial: false))
    }

    func testConsentDoesNotCoerceNumbersIntoBooleans() {
        XCTAssertEqual(MobileContract.boolean(true), true)
        XCTAssertEqual(MobileContract.boolean(false), false)
        XCTAssertNil(MobileContract.boolean(1))
        XCTAssertNil(MobileContract.boolean("true"))
        XCTAssertNil(MobileContract.boolean(nil))
    }
}
