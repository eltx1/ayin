import SwiftUI

struct RootView: View {
    @EnvironmentObject private var router: AppRouter

    var body: some View {
        HomeView()
            .fullScreenCover(item: $router.player) { destination in
                PlayerScreen(destination: destination)
            }
            .sheet(
                isPresented: Binding(
                    get: { router.webFallback != nil },
                    set: { if !$0 { router.webFallback = nil } }
                )
            ) {
                if let url = router.webFallback {
                    SafariView(url: url)
                        .ignoresSafeArea()
                }
            }
    }
}
