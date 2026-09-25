import SwiftUI

@main
struct AYINApp: App {
    @StateObject private var session = SessionController()
    @StateObject private var router = AppRouter()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .environmentObject(router)
                .task { await session.restore() }
                .onOpenURL { router.open($0) }
        }
    }
}
