import SwiftUI

struct RootView: View {
    @EnvironmentObject private var router: AppRouter
    @State private var showingNative = false

    var body: some View {
        HostedWebView(nativeFallback: { showingNative = true })
            .sheet(isPresented: $showingNative) {
                VStack(spacing: 0) {
                    HStack { Spacer(); Button("Return to AYIN") { showingNative = false }.padding() }
                    HomeView()
                }
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
