import UIKit
import GoogleMobileAds
import UserMessagingPlatform

@MainActor
final class AyinMobileAds: NSObject, BannerViewDelegate, FullScreenContentDelegate {
    private weak var owner: UIViewController?
    private weak var bannerContainer: UIView?
    private var config: MobileRuntimeConfig?
    private var initialized = false
    private var initializing = false
    private var consentBusy = false
    private var underAge = true
    private var privacyChecked = false
    private var banner: BannerView?
    private var bannerTimeout: Task<Void, Never>?
    private var interstitial: InterstitialAd?
    private var interstitialLoadedAt: Date?
    private var interstitialLoading = false
    private var loadGeneration = UUID()
    private var loadTimeout: Task<Void, Never>?
    private var fullscreen = false
    private var sessionCount = 0
    private var lastShown = Date.distantPast
    private var lastRequest = Date.distantPast
    private var paidResponses: Set<String> = []
    var emit: ([String: Any]) -> Void = { _ in }
    var setBannerHeight: (CGFloat) -> Void = { _ in }
    var busy: Bool { fullscreen || consentBusy }

    init(owner: UIViewController, bannerContainer: UIView) {
        self.owner = owner
        self.bannerContainer = bannerContainer
    }

    var appIDConfigured: Bool {
        guard let id = Bundle.main.object(forInfoDictionaryKey: "GADApplicationIdentifier") as? String else { return false }
        return id.range(of: #"^ca-app-pub-[0-9]{16}~[0-9]{10}$"#, options: .regularExpression) != nil
    }

    func configure(_ value: MobileRuntimeConfig) throws {
        guard !busy else { throw MobileBridgeError.busy }
        resetInventory()
        config = value
    }

    func privacy(requestUnderAge: Bool, options: Bool = false) async throws -> [String: Any] {
        guard appIDConfigured, let owner else { throw MobileBridgeError.unavailable }
        guard !busy, UIApplication.shared.applicationState == .active else { throw MobileBridgeError.busy }
        consentBusy = true
        defer { consentBusy = false }
        resetInventory()
        underAge = requestUnderAge
        if options {
            guard ConsentInformation.shared.privacyOptionsRequirementStatus == .required else { return privacyStatus }
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                ConsentForm.presentPrivacyOptionsForm(from: owner) { error in
                    if let error { continuation.resume(throwing: error) } else { continuation.resume() }
                }
            }
        } else {
            let parameters = RequestParameters()
            parameters.isTaggedForUnderAgeOfConsent = underAge
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                ConsentInformation.shared.requestConsentInfoUpdate(with: parameters) { error in
                    if let error { continuation.resume(throwing: error) } else { continuation.resume() }
                }
            }
            privacyChecked = true
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                ConsentForm.loadAndPresentIfRequired(from: owner) { error in
                    if let error { continuation.resume(throwing: error) } else { continuation.resume() }
                }
            }
        }
        var event = privacyStatus
        event["type"] = "privacy.changed"
        emit(event)
        return privacyStatus
    }

    var privacyStatus: [String: Any] {
        ["canRequestAds": privacyChecked && ConsentInformation.shared.canRequestAds,
         "privacyOptionsRequired": ConsentInformation.shared.privacyOptionsRequirementStatus == .required]
    }

    private func permitted() throws -> MobileRuntimeConfig {
        guard let config, config.ads.enabled, config.ads.audience == "general", !underAge else { throw MobileBridgeError.disabled }
        guard privacyChecked, ConsentInformation.shared.canRequestAds else { throw MobileBridgeError.consentRequired }
        guard appIDConfigured, UIApplication.shared.applicationState == .active else { throw MobileBridgeError.unavailable }
        guard !busy else { throw MobileBridgeError.busy }
        return config
    }

    private func initialize() async throws {
        if initialized { return }
        guard !initializing else { throw MobileBridgeError.busy }
        initializing = true
        defer { initializing = false }
        // No IDFA prompt and no personalized ad requests in this release.
        MobileAds.shared.requestConfiguration.tagForUnderAgeOfConsent = NSNumber(value: underAge)
        MobileAds.shared.requestConfiguration.maxAdContentRating = .general
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            MobileAds.shared.start { _ in continuation.resume() }
        }
        initialized = true
    }

    private func request() -> Request {
        let value = Request()
        let extras = Extras()
        extras.additionalParameters = ["npa": "1"]
        value.register(extras)
        return value
    }

    private func unit(_ config: MobileRuntimeConfig, banner: Bool) -> String? {
        #if DEBUG
        let test = true
        #else
        let test = config.ads.testMode
        #endif
        if test { return banner ? "ca-app-pub-3940256099942544/2435281174" : "ca-app-pub-3940256099942544/4411468910" }
        let value = banner ? config.ads.platforms.ios.bannerUnitId : config.ads.platforms.ios.interstitialUnitId
        return value.isEmpty ? nil : value
    }

    func showBanner() async throws -> [String: Any] {
        let value = try permitted()
        guard value.ads.banner.enabled, let unit = unit(value, banner: true), let owner, let container = bannerContainer else { throw MobileBridgeError.disabled }
        if banner != nil { return ["status": "existing"] }
        try await initialize()
        _ = try permitted()
        let view = BannerView(adSize: largeAnchoredAdaptiveBanner(width: max(1, owner.view.safeAreaLayoutGuide.layoutFrame.width)))
        banner = view
        view.adUnitID = unit
        view.rootViewController = owner
        view.delegate = self
        view.translatesAutoresizingMaskIntoConstraints = false
        view.isHidden = true
        container.addSubview(view)
        NSLayoutConstraint.activate([view.centerXAnchor.constraint(equalTo: container.centerXAnchor), view.bottomAnchor.constraint(equalTo: container.bottomAnchor)])
        view.paidEventHandler = { [weak self, weak view] value in
            guard let self, let view else { return }
            self.paid(value, response: view.responseInfo?.responseIdentifier, format: "banner")
        }
        emit(["type": "ad.request", "format": "banner"])
        view.load(request())
        bannerTimeout?.cancel()
        bannerTimeout = Task { [weak self, weak view] in
            try? await Task.sleep(nanoseconds: UInt64(value.ads.requestTimeoutMs) * 1_000_000)
            guard !Task.isCancelled, let self, let view, self.banner === view, view.isHidden else { return }
            self.hideBanner()
            self.emit(["type": "ad.failed", "format": "banner", "code": "timeout"])
        }
        return ["status": "loading"]
    }

    func hideBanner() {
        bannerTimeout?.cancel()
        bannerTimeout = nil
        banner?.delegate = nil
        banner?.paidEventHandler = nil
        banner?.removeFromSuperview()
        banner = nil
        setBannerHeight(0)
    }

    func naturalTransition() async throws -> [String: Any] {
        let value = try permitted()
        guard value.ads.interstitial.enabled, let unit = unit(value, banner: false), let owner else { throw MobileBridgeError.disabled }
        guard sessionCount < value.ads.interstitial.maxPerSession,
              Date().timeIntervalSince(lastShown) >= Double(value.ads.interstitial.cooldownSeconds) else { throw MobileBridgeError.rateLimited }
        if let ad = interstitial, let loaded = interstitialLoadedAt, Date().timeIntervalSince(loaded) < 3_600 {
            fullscreen = true
            hideBanner()
            sessionCount += 1
            lastShown = Date()
            interstitial = nil
            ad.present(from: owner)
            // Retain through dismissal, even though it cannot be presented a second time.
            presentingAd = ad
            return ["status": "showing"]
        }
        guard !interstitialLoading else { throw MobileBridgeError.busy }
        guard Date().timeIntervalSince(lastRequest) >= max(30, Double(value.ads.retryBackoffMs) / 1000) else { throw MobileBridgeError.rateLimited }
        try await initialize()
        _ = try permitted()
        lastRequest = Date()
        interstitialLoading = true
        let generation = UUID()
        loadGeneration = generation
        emit(["type": "ad.request", "format": "interstitial"])
        InterstitialAd.load(with: unit, request: request()) { [weak self] ad, error in
            guard let self, self.loadGeneration == generation else { return }
            self.loadTimeout?.cancel()
            self.interstitialLoading = false
            guard let ad, error == nil, UIApplication.shared.applicationState == .active else {
                self.emit(["type": "ad.failed", "format": "interstitial", "code": error.map { String(($0 as NSError).code) } ?? "inactive"])
                return
            }
            self.interstitial = ad
            self.interstitialLoadedAt = Date()
            ad.fullScreenContentDelegate = self
            ad.paidEventHandler = { [weak self, weak ad] value in self?.paid(value, response: ad?.responseInfo.responseIdentifier, format: "interstitial") }
            self.emit(["type": "ad.loaded", "format": "interstitial"])
            // Never auto-present a late load over content. A subsequent natural transition must request it.
        }
        loadTimeout = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(value.ads.requestTimeoutMs) * 1_000_000)
            guard !Task.isCancelled, let self, self.loadGeneration == generation, self.interstitialLoading else { return }
            self.loadGeneration = UUID()
            self.interstitialLoading = false
            self.emit(["type": "ad.failed", "format": "interstitial", "code": "timeout"])
        }
        return ["status": "loading"]
    }

    private var presentingAd: InterstitialAd?
    func resetInventory() {
        hideBanner()
        interstitial = nil
        interstitialLoadedAt = nil
        interstitialLoading = false
        loadGeneration = UUID()
        loadTimeout?.cancel()
    }
    func sessionReset() { resetInventory(); sessionCount = 0; lastShown = .distantPast }

    func bannerViewDidReceiveAd(_ bannerView: BannerView) {
        guard banner === bannerView, UIApplication.shared.applicationState == .active, (try? permitted()) != nil else { hideBanner(); return }
        bannerTimeout?.cancel()
        bannerView.isHidden = false
        setBannerHeight(bannerView.adSize.size.height)
        emit(["type": "ad.loaded", "format": "banner"])
    }
    func bannerView(_ bannerView: BannerView, didFailToReceiveAdWithError error: Error) {
        guard banner === bannerView else { return }
        hideBanner()
        emit(["type": "ad.failed", "format": "banner", "code": String((error as NSError).code)])
    }
    func adDidDismissFullScreenContent(_ ad: FullScreenPresentingAd) {
        fullscreen = false
        presentingAd = nil
        emit(["type": "ad.dismissed", "format": "interstitial"])
    }
    func ad(_ ad: FullScreenPresentingAd, didFailToPresentFullScreenContentWithError error: Error) {
        fullscreen = false
        presentingAd = nil
        emit(["type": "ad.failed", "format": "interstitial", "code": String((error as NSError).code)])
    }
    private func paid(_ value: AdValue, response: String?, format: String) {
        guard let response, paidResponses.insert(response).inserted else { return }
        if paidResponses.count > 200 { paidResponses = [response] }
        // Diagnostic event only. Firebase SDK owns ad_impression and automatic revenue; never double log.
        emit(["type": "ad.revenue", "format": format, "value": value.value.doubleValue,
              "currency": value.currencyCode, "precision": value.precision.rawValue, "estimated": true, "responseId": response])
    }
}
