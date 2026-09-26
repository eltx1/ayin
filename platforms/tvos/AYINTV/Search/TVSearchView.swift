import SwiftUI

struct TVSearchView: View {
    @EnvironmentObject private var session: SessionController
    @EnvironmentObject private var router: TVRouter
    @StateObject private var model = TVSearchViewModel()
    @State private var query = ""

    private var isKidsProfile: Bool {
        session.identity?.profile.isKids == true
    }

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

                if model.nextCursor != nil {
                    Button {
                        model.loadMore()
                    } label: {
                        VStack(spacing: 16) {
                            Image(systemName: "arrow.down.circle.fill")
                                .font(.system(size: 56))
                            Text(model.isLoadingMore ? "Loading…" : "More Results")
                                .font(.headline)
                        }
                        .frame(width: 360, height: 202)
                    }
                    .buttonStyle(.card)
                    .disabled(model.isLoadingMore)
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
        .searchable(text: $query, prompt: isKidsProfile ? "Search Kids on AYIN" : "Movies, series, creators, videos")
        .onSubmit(of: .search) {
            model.search(query, isKids: isKidsProfile)
        }
        .onChange(of: isKidsProfile) { _, newValue in
            guard query.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2 else { return }
            model.search(query, isKids: newValue)
        }
    }
}
