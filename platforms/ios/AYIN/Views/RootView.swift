import SwiftUI

struct RootView: View {
    @State private var showingNative = false

    var body: some View {
        HostedWebView(nativeFallback: { showingNative = true })
            .fullScreenCover(isPresented: $showingNative) {
                NativeHomeRoot(close: { showingNative = false })
            }
    }
}

private struct NativeHomeRoot: View {
    @EnvironmentObject private var router: AppRouter
    let close: () -> Void
    var body: some View {
        VStack(spacing: 0) {
            HStack { Spacer(); Button("Return to AYIN", action: close).padding() }
            HomeView()
        }
            .fullScreenCover(item: $router.player, onDismiss: router.playerDidDismiss) { destination in
                PlayerScreen(destination: destination)
                    .id(destination.id)
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
