import SwiftUI
import WebKit
import Combine
import GoogleMobileAds
import AVFAudio

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
    private lazy var filePicker = MobileFilePicker(owner: self)
    private var promptedSharedVideo: String?

    init(nativeFallback: @escaping () -> Void) { self.nativeFallback = nativeFallback; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        // Configure media routing without activating/stealing audio at app launch.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        let configuration = WKWebViewConfiguration()
        configuration.limitsNavigationsToAppBoundDomains = true
        configuration.allowsInlineMediaPlayback = true
        configuration.allowsPictureInPictureMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = [.audio]
        let appVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.1.0"
        configuration.applicationNameForUserAgent = "AYINMobile/iOS/\(appVersion)"
        configuration.websiteDataStore = .default()
        configuration.userContentController.add(WeakMobileScriptHandler(self), name: "ayinNative")
        let webViewAdsReady = MobileContract.validAdAppID(Bundle.main.object(forInfoDictionaryKey: "GADApplicationIdentifier"))
        let capabilities = MobileContract.capabilities.filter {
            if $0 == "ads.webview" { return webViewAdsReady }
            if $0 == "upload.recovery" {
                if #available(iOS 18.4, *) { return true }
                return false
            }
            return true
        }
            .map { "'\($0)'" }.joined(separator: ",")
        configuration.userContentController.addUserScript(WKUserScript(source: """
        (() => {
          if (window !== window.top || location.origin !== 'https://ayin.stream') return;
          const bridge = Object.freeze({version:1, capabilities:Object.freeze([\(capabilities)]), request(message) {
            window.webkit.messageHandlers.ayinNative.postMessage(message);
          }});
          Object.defineProperty(window, 'AyinMobile', {value:bridge, writable:false, configurable:false});
          document.addEventListener('click', event => {
            if (event.target instanceof HTMLInputElement && event.target.type === 'file')
              document.documentElement.dataset.ayinFileAccept = event.target.accept;
          }, true);
        })();
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView = WKWebView(frame: .zero, configuration: configuration)
        if webViewAdsReady {
            // Main actor, before the first trusted document. Registration supports GPT/HTML5
            // IMA app signals, not ad requests or consent propagation: web CMP remains separate.
            MobileAds.shared.register(webView)
        }
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never

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
            UIAction(title: "Shared video / الفيديو المشترك", image: UIImage(systemName: "square.and.arrow.down")) { [weak self] _ in self?.promptSharedVideo(force: true) },
            UIAction(title: "Save shared video to Files / حفظ الفيديو المشترك في الملفات", image: UIImage(systemName: "folder")) { [weak self] _ in self?.exportSharedVideo() },
            UIAction(title: "Discard saved upload source / حذف مصدر الرفع المحفوظ", image: UIImage(systemName: "trash"), attributes: .destructive) { [weak self] _ in
                self?.filePicker.cancel(); SharedVideoInbox.clearUploadSources(); self?.promptedSharedVideo = nil
            },
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
                Task { @MainActor in await self?.enterBackground(); self?.event(["type": "app.lifecycle", "state": "background"]) }
            },
            NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.event(["type": "app.lifecycle", "state": "active"]); self?.promptSharedVideo() }
            },
            NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] notification in
                guard (notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue else { return }
                Task { @MainActor in self?.suspend() }
            },
            NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] notification in
                guard (notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue else { return }
                Task { @MainActor in self?.suspend() }
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

    private func enterBackground() async {
        ads?.resetInventory()
        guard let webView, MobileContract.trusted(webView.url) else { return }
        let activePiP = try? await webView.callAsyncJavaScript("return Array.from(document.querySelectorAll('video')).some(v => v.webkitPresentationMode === 'picture-in-picture' || document.pictureInPictureElement === v)", arguments: [:], in: nil, contentWorld: .page)
        // Preserve only an actual PiP presentation, never general background audio.
        if activePiP as? Bool != true { webView.pauseAllMediaPlayback(completionHandler: nil) }
    }

    private func promptSharedVideo(force: Bool = false) {
        guard let webView, MobileContract.trusted(webView.url), presentedViewController == nil,
              UIApplication.shared.applicationState == .active,
              let inbox = try? SharedVideoInbox.shared(), let pending = inbox.pending(),
              force || promptedSharedVideo != pending.fileName else { return }
        let generation = documentGeneration
        Task { [weak self] in
            guard let self else { return }
            let busy = try? await webView.callAsyncJavaScript("return document.documentElement.dataset.ayinUploadActive === 'true' || document.documentElement.dataset.ayinWebAdActive === 'true' || Array.from(document.querySelectorAll('video,audio')).some(m => !m.paused && !m.ended)", arguments: [:], in: nil, contentWorld: .page)
            guard generation == documentGeneration, busy as? Bool == false, presentedViewController == nil else { return }
            if webView.url?.path == "/upload" && !force { return }
            promptedSharedVideo = pending.fileName
            let instructions: String
            if #available(iOS 18.4, *) {
                instructions = "Open Upload, sign in if needed, then choose the shared video. Nothing uploads without your action.\nافتح الرفع وسجّل الدخول عند الحاجة ثم اختر الفيديو المشترك. لن يُرفع شيء دون اختيارك."
            } else {
                instructions = "On this iOS version, save this video to Files first. Then open AYIN Upload and select that saved file. Nothing has been uploaded.\nفي إصدار iOS هذا احفظ الفيديو في الملفات أولًا، ثم افتح رفع AYIN واختر الملف المحفوظ. لم يُرفع أي شيء."
            }
            let dialog = UIAlertController(title: "Shared video ready / الفيديو المشترك جاهز", message: instructions, preferredStyle: .alert)
            if #unavailable(iOS 18.4) {
                dialog.addAction(UIAlertAction(title: "Save to Files / الحفظ في الملفات", style: .default) { [weak self] _ in self?.exportSharedVideo() })
            }
            dialog.addAction(UIAlertAction(title: "Open Upload / فتح الرفع", style: .default) { _ in MobileNavigation.shared.open(URL(string: "https://ayin.stream/upload")!) })
            dialog.addAction(UIAlertAction(title: "Later / لاحقًا", style: .cancel))
            present(dialog, animated: true)
        }
    }

    private func exportSharedVideo() {
        guard presentedViewController == nil, let inbox = try? SharedVideoInbox.shared(),
              let record = inbox.pending(), let url = try? inbox.file(for: record) else { return }
        let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
        present(picker, animated: true)
    }

    @available(iOS 18.4, *)
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        guard frame.isMainFrame, frame.securityOrigin.protocol == "https", frame.securityOrigin.host == "ayin.stream", MobileContract.trusted(webView.url) else { completionHandler(nil); return }
        let generation = documentGeneration
        Task { [weak self] in
            guard let self else { completionHandler(nil); return }
            let input = try? await webView.callAsyncJavaScript("return {busy: document.documentElement.dataset.ayinUploadActive === 'true' || document.documentElement.dataset.ayinWebAdActive === 'true', accept: document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'file' ? document.activeElement.accept : (document.documentElement.dataset.ayinFileAccept || '')}", arguments: [:], in: nil, contentWorld: .page)
            guard generation == documentGeneration, let input = input as? [String: Any], input["busy"] as? Bool == false else { completionHandler(nil); return }
            let videoOnly = (input["accept"] as? String)?.lowercased().contains("video") == true
            filePicker.open(videoOnly: videoOnly) { [weak self] urls in
                if urls != nil { self?.promptedSharedVideo = (try? SharedVideoInbox.shared())?.pending()?.fileName }
                completionHandler(self?.documentGeneration == generation ? urls : nil)
            }
        }
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
            // Google tags need friendly frames as well as external HTTPS frames. Native
            // messages remain main-frame-only and are validated against the trusted origin.
            decisionHandler(MobileContract.allowedSubframe(url) ? .allow : .cancel)
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
        filePicker.cancel()
        bridgeReady = false; runtimeConfigured = false; documentGeneration = UUID(); pendingIDs.removeAll(); seenIDs.removeAll(); ads.resetInventory()
        MobileFirebase.shared.navigating()
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        offlineView.isHidden = true
        backButton.isEnabled = webView.canGoBack
        promptSharedVideo()
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
            do { response["result"] = try await dispatch(method, params: params, generation: generation); response["ok"] = true }
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

    private func dispatch(_ method: String, params: [String: Any], generation: UUID) async throws -> [String: Any] {
        guard generation == documentGeneration else { throw MobileBridgeError.invalidRequest }
        let firebase = MobileFirebase.shared
        switch method {
        case "upload.clear":
            guard params.isEmpty else { throw MobileBridgeError.invalidRequest }
            filePicker.cancel(); SharedVideoInbox.clearUploadSources(); promptedSharedVideo = nil
            return ["cleared": true]
        case "share.open":
            try keys(params, ["url"])
            guard Set(params.keys) == ["url"], let url = MobileContract.shareURL(params["url"]),
                  UIApplication.shared.applicationState == .active, presentedViewController == nil else { throw MobileBridgeError.invalidRequest }
            ads.resetInventory()
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            sheet.popoverPresentationController?.sourceView = view
            sheet.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
            present(sheet, animated: true)
            return ["shared": true] // Share-sheet presentation, not proof of recipient delivery.
        case "runtime.configure":
            try keys(params, ["config"])
            guard let raw = params["config"] else { throw MobileBridgeError.invalidConfig }
            let config = try MobileRuntimeConfig.parse(raw)
            guard !ads.busy else { throw MobileBridgeError.busy }
            if runtimeConfigured {
                let uploading = try? await webView.callAsyncJavaScript("return document.documentElement.dataset.ayinUploadActive === 'true' || document.documentElement.dataset.ayinWebAdActive === 'true' || /^\\/(?:en\\/|ar\\/)?upload(?:\\/|$)/.test(location.pathname)", arguments: [:], in: nil, contentWorld: .page)
                guard uploading as? Bool == false else { throw MobileBridgeError.busy }
            }
            guard generation == documentGeneration else { throw MobileBridgeError.invalidRequest }
            let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0"
            let runtimeAllowed = config.supports(appVersion: version, installationId: firebase.installationId)
            let upgradeRequired = config.requiresUpgrade(appVersion: version)
            try ads.configure(config, runtimeAllowed: runtimeAllowed)
            firebase.configure(config, runtimeAllowed: runtimeAllowed)
            bridgeReady = true; runtimeConfigured = true
            return ["platform": "ios", "appVersion": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0", "installationId": firebase.installationId,
                    "boundAccountId": firebase.accountId as Any? ?? NSNull(),
                    "runtimeAllowed": runtimeAllowed, "upgradeRequired": upgradeRequired,
                    "configured": ["firebase": firebase.configured, "ads": ads.appIDConfigured]]
        case "session.reset":
            try keys(params, [])
            // Auth reconciliation also uses session.reset on an initial, unbound login.
            // The hosted logout/real-account-switch path separately calls upload.clear.
            filePicker.cancel()
            ads.sessionReset(); await firebase.reset()
            return ["reset": true]
        default: guard runtimeConfigured else { throw MobileBridgeError.disabled }
        }
        switch method {
        case "privacy.request":
            try keys(params, ["underAgeOfConsent"])
            guard let age = MobileContract.boolean(params["underAgeOfConsent"]) else { throw MobileBridgeError.invalidRequest }
            lastUnderAge = age
            return try await ads.privacy(requestUnderAge: age)
        case "privacy.options": try keys(params, []); return try await ads.privacy(requestUnderAge: lastUnderAge, options: true)
        case "analytics.consent":
            try keys(params, ["enabled"])
            guard let value = MobileContract.boolean(params["enabled"]) else { throw MobileBridgeError.invalidRequest }
            return ["enabled": firebase.setConsent(value)]
        case "analytics.event":
            try keys(params, ["name", "params"])
            guard let name = params["name"] as? String, let values = params["params"] as? [String: Any] else { throw MobileBridgeError.invalidRequest }
            try firebase.event(name, params: values); return ["accepted": true]
        case "analytics.user":
            try keys(params, ["id"])
            guard params["id"] is NSNull || params["id"] is String else { throw MobileBridgeError.invalidRequest }
            try firebase.setUser(params["id"] as? String); return ["accepted": true]
        case "ads.banner":
            try MobileContract.validateAdRequest(params, interstitial: false)
            let mediaActive = try? await webView.callAsyncJavaScript("return document.documentElement.dataset.ayinUploadActive === 'true' || document.documentElement.dataset.ayinWebAdActive === 'true' || Array.from(document.querySelectorAll('video,audio')).some(m => !m.paused && !m.ended)", arguments: [:], in: nil, contentWorld: .page)
            guard generation == documentGeneration, mediaActive as? Bool == false else { throw MobileBridgeError.busy }
            return try await ads.showBanner()
        case "ads.hideBanner": try keys(params, []); ads.hideBanner(); return ["hidden": true]
        case "ads.interstitial":
            try MobileContract.validateAdRequest(params, interstitial: true)
            let mediaActive = try? await webView.callAsyncJavaScript("return document.documentElement.dataset.ayinUploadActive === 'true' || document.documentElement.dataset.ayinWebAdActive === 'true' || Array.from(document.querySelectorAll('video,audio')).some(m => !m.paused && !m.ended)", arguments: [:], in: nil, contentWorld: .page)
            guard generation == documentGeneration, mediaActive as? Bool == false else { throw MobileBridgeError.busy }
            return try await ads.naturalTransition()
        case "notifications.request", "notifications.token":
            try keys(params, ["accountId"])
            guard let account = params["accountId"] as? String, UUID(uuidString: account) != nil else { throw MobileBridgeError.invalidRequest }
            try firebase.bindAccount(account)
            if method == "notifications.request" { return ["granted": try await firebase.requestNotifications()] }
            return ["token": await firebase.currentToken() as Any? ?? NSNull()]
        default: throw MobileBridgeError.unsupported
        }
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
        webView.callAsyncJavaScript("window.dispatchEvent(new CustomEvent(eventName, {detail: payload}));", arguments: ["eventName": name, "payload": payload], in: nil, in: .page, completionHandler: nil)
    }
    deinit {
        observerTokens.forEach { NotificationCenter.default.removeObserver($0) }
    }
}

@MainActor
private final class WeakMobileScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
