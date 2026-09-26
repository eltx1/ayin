import SwiftUI

@main
struct AYINTVApp: App {
    @StateObject private var session: SessionController
    @StateObject private var router = TVRouter()

    init() {
        _session = StateObject(
            wrappedValue: SessionController(store: TVKeychainSessionStore())
        )
    }

    var body: some Scene {
        WindowGroup {
            TVRootView()
                .environmentObject(session)
                .environmentObject(router)
                .task {
                    await session.restore()
                }
                .onOpenURL { url in
                    router.open(url: url)
                }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    guard let url = activity.webpageURL else { return }
                    router.open(url: url)
                }
        }
    }
}
