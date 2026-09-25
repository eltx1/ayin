import SwiftUI

struct TVSearchView: View {
    @EnvironmentObject private var router: TVRouter
    @StateObject private var model = TVSearchViewModel()
    @State private var query = ""

    var body: some View {
        ScrollView {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 360), spacing: 28)],
                spacing: 30
            ) {
                ForEach(model.items) { item in
                    TVContentCard(
                        title: item.title,
                        subtitle: item.meta ?? item.kicker,
                        artworkObjectKey: item.artworkObjectKey,
                        progress: item.progress
                    ) {
                        router.open(href: item.href)
                    }
                }
            }
            .padding(70)
        }
        .overlay {
            if model.isLoading {
                ProgressView()
            } else if model.items.isEmpty, let error = model.errorMessage {
                ContentUnavailableView(
                    "No results",
                    systemImage: "magnifyingglass",
                    description: Text(error)
                )
            }
        }
        .navigationTitle("Search")
        .searchable(text: $query, prompt: "Movies, series, creators, videos")
        .onSubmit(of: .search) {
            model.search(query)
        }
    }
}
