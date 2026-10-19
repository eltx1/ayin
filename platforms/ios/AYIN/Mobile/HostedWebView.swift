import SwiftUI
import WebKit
import Combine

@MainActor
final class MobileNavigation: ObservableObject {
    static let shared = MobileNavigation()
    @Published private(set) var destination: URL?
    @Published private(set) var revision = 0
    func open(_ url: URL) {
        if MobileContract.trusted(url) { destination = url }
        else if let link = DeepLink.parse(url) {
            switch link {
            case let .video(slug, isKids): destination = PlayerDestination(kind: .video, slug: slug, isKids: isKids).shareURL
            case let .live(slug): destination = PlayerDestination(kind: .live, slug: slug).shareURL
            case let .web(url): guard MobileContract.trusted(url) else { return }; destination = url
            }
        } else { return }
        revision += 1
    }
}

struct HostedWebView: UIViewControllerRepresentable {
    @ObservedObject var navigation = MobileNavigation.shared
    let nativeFallback: () -> Void

    func makeUIViewController(context: Context) -> HostedWebController {
        HostedWebController(nativeFallback: nativeFallback)
    }
    func updateUIViewController(_ controller: HostedWebController, context: Context) {
        if controller.navigationRevision != navigation.revision, let url = navigation.destination {
            controller.navigationRevision = navigation.revision
            controller.open(url)
        }
    }
}

@MainActor
final class HostedWebController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    var navigationRevision = -1
    private let nativeFallback: () -> Void
    private var webView: WKWebView!
    private let bannerContainer = UIView()
    private var bannerHeight: NSLayoutConstraint!
    private var ads: AyinMobileAds!
    private var bridgeReady = false
    private var documentGeneration = UUID()
    private var pendingIDs: Set<String> = []
    private var seenIDs: Set<String> = []
    private var observerTokens: [NSObjectProtocol] = []
    private var offlineView: UIStackView!
    private var backButton: UIButton!
    private var runtimeConfigured = false
    private var lastUnderAge = true
    private var deferredNativeEvents: [[String: Any]] = []

    init(nativeFallback: @escaping () -> Void) { self.nativeFallback = nativeFallback; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let configuration = WKWebViewConfiguration()
        configuration.limitsNavigationsToAppBoundDomains = true
        configuration.allowsInlineMediaPlayback = true
        configuration.allowsPictureInPictureMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = [.audio]
        configuration.websiteDataStore = .default()
        configuration.userContentController.add(WeakMobileScriptHandler(self), name: "ayinNative")
        let capabilities = MobileContract.capabilities.map { "'\($0)'" }.joined(separator: ",")
        configuration.userContentController.addUserScript(WKUserScript(source: """
        (() => {
          if (window !== window.top || location.origin !== 'https://ayin.stream') return;
          const bridge = Object.freeze({version:1, capabilities:Object.freeze([\(capabilities)]), request(message) {
            window.webkit.messageHandlers.ayinNative.postMessage(message);
          }});
          Object.defineProperty(window, 'AyinMobile', {value:bridge, writable:false, configurable:false});
        })();
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile AYINMobile/iOS/1.0.0"

        let toolbar = UIStackView()
        toolbar.axis = .horizontal
        toolbar.alignment = .center
        toolbar.distribution = .equalSpacing
        backButton = UIButton(type: .system)
        backButton.setImage(UIImage(systemName: "chevron.backward"), for: .normal)
        backButton.accessibilityLabel = NSLocalizedString("Back", comment: "Navigation")
        backButton.addAction(UIAction { [weak self] _ in self?.webView.goBack() }, for: .touchUpInside)
        let title = UILabel(); title.text = "AYIN"; title.font = .boldSystemFont(ofSize: 17)
        let menu = UIButton(type: .system)
        menu.setImage(UIImage(systemName: "ellipsis.circle"), for: .normal)
        menu.accessibilityLabel = NSLocalizedString("App options", comment: "Navigation")
        menu.showsMenuAsPrimaryAction = true
        menu.menu = UIMenu(children: [
            UIAction(title: NSLocalizedString("Reload", comment: "Navigation"), image: UIImage(systemName: "arrow.clockwise")) { [weak self] _ in self?.webView.reload() },
            UIAction(title: NSLocalizedString("Privacy options", comment: "Privacy"), image: UIImage(systemName: "hand.raised")) { [weak self] _ in self?.openPrivacy() },
            UIAction(title: NSLocalizedString("Native video browser", comment: "Navigation"), image: UIImage(systemName: "play.rectangle")) { [weak self] _ in self?.suspend(); self?.nativeFallback() }
        ])
        toolbar.addArrangedSubview(backButton); toolbar.addArrangedSubview(title); toolbar.addArrangedSubview(menu)
        [toolbar, webView, bannerContainer].forEach { $0.translatesAutoresizingMaskIntoConstraints = false; view.addSubview($0) }
        bannerHeight = bannerContainer.heightAnchor.constraint(equalToConstant: 0)
        NSLayoutConstraint.activate([
            toolbar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), toolbar.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            toolbar.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16), toolbar.heightAnchor.constraint(equalToConstant: 40),
            webView.topAnchor.constraint(equalTo: toolbar.bottomAnchor), webView.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor), webView.bottomAnchor.constraint(equalTo: bannerContainer.topAnchor),
            bannerContainer.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor), bannerContainer.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            bannerContainer.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor), bannerHeight
        ])
        ads = AyinMobileAds(owner: self, bannerContainer: bannerContainer)
        ads.emit = { [weak self] event in
            if let type = event["type"] as? String, let format = event["format"] as? String {
                MobileFirebase.shared.adEvent(type.replacingOccurrences(of: ".", with: "_"), format: format, code: event["code"] as? String)
            }
            self?.event(event)
        }
        ads.setBannerHeight = { [weak self] height in self?.bannerHeight.constant = height }
        makeOfflineView()
        MobileFirebase.shared.bind { [weak self] event in self?.event(event) }
        observerTokens = [
            NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.suspend(); self?.event(["type": "app.lifecycle", "state": "background"]) }
            },
            NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.event(["type": "app.lifecycle", "state": "active"]) }
            }
        ]
        open(MobileNavigation.shared.destination ?? AppEnvironment.webBaseURL)
    }

    override func viewWillDisappear(_ animated: Bool) { super.viewWillDisappear(animated); suspend() }

    private func makeOfflineView() {
        offlineView = UIStackView()
        offlineView.axis = .vertical; offlineView.spacing = 18; offlineView.alignment = .center
        offlineView.backgroundColor = .systemBackground; offlineView.isHidden = true
        let title = UILabel(); title.text = NSLocalizedString("AYIN is unavailable", comment: "Offline"); title.font = .preferredFont(forTextStyle: .title2)
        let body = UILabel(); body.text = NSLocalizedString("Check your connection and retry. The native video browser is also available.", comment: "Offline"); body.numberOfLines = 0; body.textAlignment = .center
        let retry = UIButton(type: .system); retry.setTitle(NSLocalizedString("Retry", comment: "Offline"), for: .normal)
        retry.addAction(UIAction { [weak self] _ in self?.open(AppEnvironment.webBaseURL) }, for: .touchUpInside)
        let native = UIButton(type: .system); native.setTitle(NSLocalizedString("Native video browser", comment: "Offline"), for: .normal)
        native.addAction(UIAction { [weak self] _ in self?.nativeFallback() }, for: .touchUpInside)
        [title, body, retry, native].forEach { offlineView.addArrangedSubview($0) }
        offlineView.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(offlineView)
        NSLayoutConstraint.activate([offlineView.centerYAnchor.constraint(equalTo: view.centerYAnchor), offlineView.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24), offlineView.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24)])
    }

    func open(_ url: URL) {
        guard MobileContract.trusted(url) else { return }
        loadViewIfNeeded()
        offlineView.isHidden = true
        webView.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 30))
    }

    private func suspend() {
        ads?.resetInventory()
        guard let webView else { return }
        webView.pauseAllMediaPlayback(completionHandler: nil)
    }

    private func openPrivacy() {
        Task { [weak self] in
            guard let self else { return }
            do { _ = try await ads.privacy(requestUnderAge: lastUnderAge, options: true) }
            catch { event(["type": "privacy.error", "code": "privacy_options_unavailable"]) }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if navigationAction.targetFrame?.isMainFrame == false {
            // Embedded media may use third-party frames. Message handling below never trusts a subframe.
            decisionHandler(url.scheme == "https" || url.scheme == "about" ? .allow : .cancel)
            return
        }
        if MobileContract.trusted(url) { decisionHandler(.allow); return }
        decisionHandler(.cancel)
        if navigationAction.navigationType == .linkActivated && ["https", "http", "mailto", "tel"].contains(url.scheme ?? "") {
            UIApplication.shared.open(url)
        }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        if MobileContract.trusted(url) { open(url) }
        else if url.scheme == "https" { UIApplication.shared.open(url) }
        return nil
    }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        bridgeReady = false; runtimeConfigured = false; documentGeneration = UUID(); pendingIDs.removeAll(); seenIDs.removeAll(); ads.resetInventory()
        MobileFirebase.shared.navigating()
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        offlineView.isHidden = true
        backButton.isEnabled = webView.canGoBack
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { navigationFailed(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { navigationFailed(error) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { suspend(); bridgeReady = false; offlineView.isHidden = false }
    private func navigationFailed(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        bridgeReady = false; suspend(); offlineView.isHidden = false
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "ayinNative", message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == "https", message.frameInfo.securityOrigin.host == "ayin.stream",
              [0, 443].contains(message.frameInfo.securityOrigin.port), MobileContract.trusted(webView.url),
              let raw = message.body as? [String: Any], Set(raw.keys) == ["id", "method", "params"],
              let id = raw["id"] as? String, id.range(of: #"^[A-Za-z0-9_-]{1,100}$"#, options: .regularExpression) != nil,
              let method = raw["method"] as? String, MobileContract.methods.contains(method),
              let params = raw["params"] as? [String: Any], JSONSerialization.isValidJSONObject(raw),
              let bytes = try? JSONSerialization.data(withJSONObject: raw), bytes.count <= 32_768,
              pendingIDs.count < 32, !seenIDs.contains(id) else { return }
        seenIDs.insert(id); pendingIDs.insert(id)
        if seenIDs.count > 1000 { seenIDs = pendingIDs }
        let generation = documentGeneration
        Task { [weak self] in
            guard let self else { return }
            var response: [String: Any] = ["id": id]
            do { response["result"] = try await dispatch(method, params: params); response["ok"] = true }
            catch { response["ok"] = false; response["error"] = ["code": (error as? MobileBridgeError)?.rawValue ?? "native_failure"] }
            guard generation == documentGeneration else { return }
            pendingIDs.remove(id)
            send("ayin:mobile-response", payload: response)
            if method == "runtime.configure", response["ok"] as? Bool == true {
                MobileFirebase.shared.ready()
                let queued = deferredNativeEvents; deferredNativeEvents.removeAll()
                queued.forEach(event)
            }
        }
    }

    private func keys(_ params: [String: Any], _ allowed: Set<String>) throws {
        guard Set(params.keys).isSubset(of: allowed) else { throw MobileBridgeError.invalidRequest }
    }

    private func dispatch(_ method: String, params: [String: Any]) async throws -> [String: Any] {
        let firebase = MobileFirebase.shared
        switch method {
        case "runtime.configure":
            try keys(params, ["config"])
            guard let raw = params["config"] else { throw MobileBridgeError.invalidConfig }
            let config = try MobileRuntimeConfig.parse(raw)
            guard !ads.busy else { throw MobileBridgeError.busy }
            let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0"
            guard config.supports(appVersion: version, installationId: firebase.installationId) else { throw MobileBridgeError.unsupported }
            try ads.configure(config); firebase.configure(config)
            bridgeReady = true; runtimeConfigured = true
            return ["platform": "ios", "appVersion": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0", "installationId": firebase.installationId,
                    "configured": ["firebase": firebase.configured, "ads": ads.appIDConfigured]]
        case "session.reset":
            try keys(params, [])
            ads.sessionReset(); await firebase.reset()
            return ["reset": true]
        default: guard runtimeConfigured else { throw MobileBridgeError.disabled }
        }
        switch method {
        case "privacy.request":
            try keys(params, ["underAgeOfConsent"])
            guard let age = params["underAgeOfConsent"] as? Bool else { throw MobileBridgeError.invalidRequest }
            lastUnderAge = age
            return try await ads.privacy(requestUnderAge: age)
        case "privacy.options": try keys(params, []); return try await ads.privacy(requestUnderAge: lastUnderAge, options: true)
        case "analytics.consent":
            try keys(params, ["enabled"])
            guard let value = params["enabled"] as? Bool else { throw MobileBridgeError.invalidRequest }
            firebase.setConsent(value); return ["enabled": value]
        case "analytics.event":
            try keys(params, ["name", "params"])
            guard let name = params["name"] as? String, let values = params["params"] as? [String: Any] else { throw MobileBridgeError.invalidRequest }
            try firebase.event(name, params: values); return ["accepted": true]
        case "analytics.user":
            try keys(params, ["id"])
            guard params["id"] is NSNull || params["id"] is String else { throw MobileBridgeError.invalidRequest }
            try firebase.setUser(params["id"] as? String); return ["accepted": true]
        case "ads.banner":
            try keys(params, ["placement"]); try placement(params)
            return try await ads.showBanner()
        case "ads.hideBanner": try keys(params, []); ads.hideBanner(); return ["hidden": true]
        case "ads.interstitial":
            try keys(params, ["placement", "naturalTransition"]); try placement(params)
            guard params["naturalTransition"] as? Bool == true else { throw MobileBridgeError.invalidRequest }
            let mediaActive = try? await webView.callAsyncJavaScript("return Array.from(document.querySelectorAll('video,audio')).some(m => !m.paused && !m.ended)", arguments: [:], in: nil, contentWorld: .page)
            guard mediaActive as? Bool == false else { throw MobileBridgeError.busy }
            return try await ads.naturalTransition()
        case "notifications.request", "notifications.token":
            try keys(params, ["accountId"])
            guard let account = params["accountId"] as? String, UUID(uuidString: account) != nil else { throw MobileBridgeError.invalidRequest }
            firebase.bindAccount(account)
            if method == "notifications.request" { return ["granted": try await firebase.requestNotifications()] }
            return ["token": await firebase.currentToken() as Any? ?? NSNull()]
        default: throw MobileBridgeError.unsupported
        }
    }

    private func placement(_ params: [String: Any]) throws {
        guard let value = params["placement"] as? String,
              ["home", "feed", "search", "channel", "browse_bottom", "natural_transition", "video_exit"].contains(value) else { throw MobileBridgeError.invalidRequest }
    }
    private func event(_ payload: [String: Any]) {
        guard bridgeReady else {
            if (payload["type"] as? String)?.hasPrefix("notification.") == true { deferredNativeEvents = Array((deferredNativeEvents + [payload]).suffix(10)) }
            return
        }
        send("ayin:mobile-event", payload: payload)
    }
    private func send(_ name: String, payload: [String: Any]) {
        guard MobileContract.trusted(webView.url) else { return }
        webView.callAsyncJavaScript("window.dispatchEvent(new CustomEvent(eventName, {detail: payload}));", arguments: ["eventName": name, "payload": payload], in: nil, contentWorld: .page, completionHandler: nil)
    }
    deinit {
        observerTokens.forEach { NotificationCenter.default.removeObserver($0) }
    }
}

private final class WeakMobileScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
