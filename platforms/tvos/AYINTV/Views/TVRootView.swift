import SwiftUI

struct TVRootView: View {
    @EnvironmentObject private var router: TVRouter
    @EnvironmentObject private var session: SessionController

    var body: some View {
        NavigationStack(path: $router.path) {
            TabView {
                TVHomeView()
                    .tabItem {
                        Label("Home", systemImage: "house.fill")
                    }

                TVSearchView()
                    .tabItem {
                        Label("Search", systemImage: "magnifyingglass")
                    }

                TVMyAyinView()
                    .tabItem {
                        Label("My AYIN", systemImage: "play.square.stack")
                    }

                TVAccountView()
                    .tabItem {
                        Label("Account", systemImage: "person.crop.circle")
                    }
            }
            .navigationDestination(for: TVRoute.self) { route in
                TVDetailView(route: route)
            }
        }
        .fullScreenCover(item: $router.player) { destination in
            TVPlayerScreen(destination: destination)
                .environmentObject(session)
        }
    }
}
