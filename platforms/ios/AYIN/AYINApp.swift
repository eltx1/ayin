import SwiftUI

@main
struct AYINApp: App {
    @UIApplicationDelegateAdaptor(MobileAppDelegate.self) private var appDelegate
    @StateObject private var session = SessionController()
    @StateObject private var router = AppRouter()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .environmentObject(router)
                .task { await session.restore() }
                .onOpenURL { MobileNavigation.shared.open($0) }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL { MobileNavigation.shared.open(url) }
                }
        }
    }
}
