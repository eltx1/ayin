import UIKit
import UserNotifications
import FirebaseCore
import FirebaseAnalytics
import FirebaseMessaging
import FirebaseCrashlytics

@MainActor
final class MobileFirebase: NSObject, MessagingDelegate, UNUserNotificationCenterDelegate {
    static let shared = MobileFirebase()
    private(set) var configured = false
    private(set) var token: String?
    private var analyticsAllowed = false
    private var analyticsRemoteEnabled = false
    private var notificationsRemoteEnabled = false
    private var receiver: (([String: Any]) -> Void)?
    private var pending: [[String: Any]] = []
    private var seenNotifications: Set<String> = []
    private var accountId: String?
    private var sessionGeneration = UUID()
    private var webReady = false

    var installationId: String {
        let key = "ayin.mobile.installation.v1"
        if let stored = UserDefaults.standard.string(forKey: key), UUID(uuidString: stored) != nil { return stored }
        let value = UUID().uuidString.lowercased()
        UserDefaults.standard.set(value, forKey: key)
        return value
    }

    func initialize() {
        guard !configured, let path = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist"),
              let options = FirebaseOptions(contentsOfFile: path), options.bundleID == Bundle.main.bundleIdentifier,
              !options.googleAppID.isEmpty, !options.gcmSenderID.isEmpty else { return }
        FirebaseApp.configure(options: options)
        configured = true
        // No persisted SDK choice can turn collection on before the current web consent is reconciled.
        Analytics.setAnalyticsCollectionEnabled(false)
        Analytics.setConsent([.analyticsStorage: .denied, .adStorage: .denied, .adUserData: .denied, .adPersonalization: .denied])
        Analytics.setUserID(nil)
        Crashlytics.crashlytics().setCrashlyticsCollectionEnabled(false)
        Messaging.messaging().isAutoInitEnabled = false
        Messaging.messaging().delegate = self
        UNUserNotificationCenter.current().delegate = self
    }

    func configure(_ config: MobileRuntimeConfig) {
        analyticsRemoteEnabled = config.analytics.enabled
        notificationsRemoteEnabled = config.notifications.enabled
        applyAnalyticsConsent()
    }

    func setConsent(_ enabled: Bool) {
        analyticsAllowed = enabled
        applyAnalyticsConsent()
    }

    private func applyAnalyticsConsent() {
        guard configured else { return }
        let allowed = analyticsAllowed && analyticsRemoteEnabled
        Analytics.setConsent([.analyticsStorage: allowed ? .granted : .denied, .adStorage: .denied, .adUserData: .denied, .adPersonalization: .denied])
        Analytics.setAnalyticsCollectionEnabled(allowed)
        Crashlytics.crashlytics().setCrashlyticsCollectionEnabled(allowed)
        if !allowed { Analytics.setUserID(nil) }
    }

    func event(_ name: String, params: [String: Any]) throws {
        let safe = try MobileContract.event(name, params: params)
        guard configured else { throw MobileBridgeError.unavailable }
        guard analyticsAllowed && analyticsRemoteEnabled else { throw MobileBridgeError.consentRequired }
        Analytics.logEvent(name, parameters: safe)
    }

    func setUser(_ id: String?) throws {
        guard configured else { throw MobileBridgeError.unavailable }
        guard id == nil || (id!.range(of: #"^[A-Za-z0-9_-]{1,128}$"#, options: .regularExpression) != nil) else { throw MobileBridgeError.invalidRequest }
        Analytics.setUserID(analyticsAllowed && analyticsRemoteEnabled ? id : nil)
    }

    func requestNotifications() async throws -> Bool {
        guard configured else { throw MobileBridgeError.unavailable }
        guard notificationsRemoteEnabled else { throw MobileBridgeError.disabled }
        let generation = sessionGeneration
        let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
        guard generation == sessionGeneration, accountId != nil else { return false }
        if granted {
            Messaging.messaging().isAutoInitEnabled = true
            UIApplication.shared.registerForRemoteNotifications()
        }
        return granted
    }

    func currentToken() async -> String? {
        guard configured, notificationsRemoteEnabled else { return nil }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return nil }
        if accountId != nil {
            Messaging.messaging().isAutoInitEnabled = true
            UIApplication.shared.registerForRemoteNotifications()
        }
        return token
    }

    func adEvent(_ type: String, format: String, code: String? = nil) {
        guard configured, analyticsAllowed, analyticsRemoteEnabled,
              ["ad_request", "ad_loaded", "ad_failed"].contains(type) else { return }
        var params: [String: Any] = ["ad_format": format]
        if let code { params["error_code"] = String(code.prefix(40)) }
        Analytics.logEvent(type, parameters: params)
    }

    func apnsRegistered(_ data: Data) {
        guard configured, notificationsRemoteEnabled, accountId != nil else { return }
        // APNs bytes are passed only to Firebase. Only the FCM registration token crosses the bridge.
        Messaging.messaging().apnsToken = data
        let generation = sessionGeneration
        Messaging.messaging().token { [weak self] value, _ in
            Task { @MainActor in guard self?.sessionGeneration == generation else { return }; self?.receivedToken(value) }
        }
    }

    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        receivedToken(fcmToken)
    }

    private func receivedToken(_ value: String?) {
        guard accountId != nil, notificationsRemoteEnabled, let value, !value.isEmpty, value.count <= 4096 else { return }
        token = value
        emit(["type": "notification.token", "token": value, "tokenType": "fcm"])
    }

    func reset() async {
        accountId = nil
        sessionGeneration = UUID()
        analyticsAllowed = false
        applyAnalyticsConsent()
        token = nil
        pending.removeAll()
        if configured {
            Analytics.setUserID(nil)
            Analytics.resetAnalyticsData()
            Messaging.messaging().isAutoInitEnabled = false
            try? await Messaging.messaging().deleteToken()
        }
        UIApplication.shared.unregisterForRemoteNotifications()
    }

    func bindAccount(_ id: String) {
        if accountId != id { sessionGeneration = UUID(); accountId = id }
    }
    func bind(_ handler: @escaping ([String: Any]) -> Void) { receiver = handler; webReady = false }
    func navigating() { webReady = false }
    func ready() {
        webReady = true
        let events = pending
        pending.removeAll()
        for event in events { receiver?(event) }
        if let token { receiver?(["type": "notification.token", "token": token, "tokenType": "fcm"]) }
    }
    func unbind() { receiver = nil; webReady = false }

    func emit(_ payload: [String: Any]) {
        if webReady, let receiver { receiver(payload) }
        else { pending = Array((pending + [payload]).suffix(10)) }
    }

    func notification(_ userInfo: [AnyHashable: Any], opened: Bool) {
        guard let id = userInfo["notificationId"] as? String, UUID(uuidString: id) != nil,
              let recipient = userInfo["recipientAccountId"] as? String, UUID(uuidString: recipient) != nil
        else { return }
        // A cold-start tap may arrive before the web restores its session; the web resolves
        // this opaque ID through an authenticated ownership/visibility endpoint.
        guard accountId == nil && opened || recipient == accountId else { return }
        let dedupe = "\(opened):\(id)"
        guard !seenNotifications.contains(dedupe) else { return }
        seenNotifications.insert(dedupe)
        if seenNotifications.count > 100 { seenNotifications = [dedupe] }
        emit(["type": opened ? "notification.opened" : "notification.received", "notificationId": id,
              "recipientAccountId": recipient])
        if configured && analyticsAllowed && analyticsRemoteEnabled {
            // SDK swizzling is disabled: these are explicitly owned by this delegate.
            Analytics.logEvent(opened ? "ayin_notification_open" : "ayin_notification_receive", parameters: nil)
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        let recipient = notification.request.content.userInfo["recipientAccountId"] as? String
        guard let accountId, recipient == accountId else { completionHandler([]); return }
        self.notification(notification.request.content.userInfo, opened: false)
        completionHandler([.banner, .sound, .badge])
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        notification(response.notification.request.content.userInfo, opened: true)
        completionHandler()
    }
}

@MainActor
final class MobileAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        MobileFirebase.shared.initialize()
        return true
    }
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        MobileFirebase.shared.apnsRegistered(deviceToken)
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        MobileFirebase.shared.emit(["type": "notification.error", "code": "apns_registration_failed"])
    }
}
