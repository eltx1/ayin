import SwiftUI

struct TVDetailView: View {
    let route: TVRoute

    @EnvironmentObject private var router: TVRouter
    @EnvironmentObject private var session: SessionController
    @StateObject private var model = TVDetailViewModel()

    private var loadIdentity: String {
        if session.isRestoring { return "restoring" }
        return [String(describing: route), session.identity?.account.id ?? "guest", session.identity?.profile.id ?? "",
                session.identity?.profile.isKids == true ? "kids" : "general", session.token ?? ""].joined(separator: ":")
    }

    private func load() async {
        guard !session.isRestoring, session.token == nil || session.isAuthenticated else {
            model.invalidateViewer()
            return
        }
        await model.load(route, token: session.token, accountId: session.identity?.account.id,
                         profileId: session.identity?.profile.id, isKids: session.identity?.profile.isKids == true)
    }

    var body: some View {
        Group {
            if model.isLoading {
                ProgressView("Loading…")
            } else if let error = model.errorMessage {
                VStack(spacing: 30) {
                    ContentUnavailableView(
                        "Content unavailable",
                        systemImage: "exclamationmark.triangle",
                        description: Text(error)
                    )
                    Button("Try Again") {
                        Task { await load() }
                    }
                }
            } else {
                content
            }
        }
        .task(id: loadIdentity) {
            await load()
        }
        .onReceive(session.$identity) { identity in
            model.viewerDidChange(token: identity == nil ? nil : session.token,
                                  accountId: identity?.account.id, profileId: identity?.profile.id,
                                  isKids: identity?.profile.isKids == true)
        }
        .onReceive(session.$isRestoring) { restoring in
            if restoring { model.invalidateViewer() }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch route {
        case let .video(slug, _):
            if let video = model.video {
                hero(
                    title: video.title,
                    subtitle: video.subtitle,
                    description: TVStrings.videoDescription(protocolName: video.protocolName)
                ) {
                    router.play(.video(slug: slug, isKids: video.isKids))
                }
            }

        case let .channel(handle):
            if let channel = model.channel {
                ScrollView {
                    VStack(alignment: .leading, spacing: 36) {
                        heroHeader(
                            title: channel.channel.name,
                            subtitle: "@\(channel.channel.handle)",
                            description: channel.channel.description
                        )

                        if channel.creatorTv?.status == "ACTIVE" {
                            Button {
                                router.open(.creatorTV(handle: handle))
                            } label: {
                                Label("Open Creator TV", systemImage: "tv")
                            }
                            .buttonStyle(.borderedProminent)
                        }

                        if !channel.videos.isEmpty {
                            Text("Videos").font(.title2.bold())
                            LazyVGrid(
                                columns: [GridItem(.adaptive(minimum: 360), spacing: 28)],
                                spacing: 30
                            ) {
                                ForEach(channel.videos) { video in
                                    TVContentCard(
                                        title: video.title,
                                        subtitle: channel.channel.name,
                                        artworkObjectKey: video.thumbnail?.objectKey,
                                        progress: nil
                                    ) {
                                        router.open(.video(slug: video.slug, isKids: false))
                                    }
                                }
                            }
                        }
                    }
                    .padding(70)
                }
            }

        case let .creatorTV(handle):
            if let tv = model.creatorTV {
                ScrollView {
                    VStack(alignment: .leading, spacing: 34) {
                        heroHeader(
                            title: tv.tv.name,
                            subtitle: tv.channel.name,
                            description: TVStrings.creatorTVDescription(state: tv.tv.state, status: tv.tv.status)
                        )

                        Button {
                            router.play(.creatorTV(handle: handle))
                        } label: {
                            Label("Watch Creator TV", systemImage: "play.fill")
                        }
                        .buttonStyle(.borderedProminent)

                        if let now = tv.schedule.nowPlaying {
                            programSection(TVStrings.text("Now Playing"), program: now)
                        }
                        if let upNext = tv.schedule.upNext {
                            programSection(TVStrings.text("Up Next"), program: upNext)
                        }

                        if !tv.schedule.guide.isEmpty {
                            Text("Guide").font(.title2.bold())
                            VStack(alignment: .leading, spacing: 18) {
                                ForEach(tv.schedule.guide.prefix(12)) { program in
                                    Button {
                                        router.open(.video(slug: program.video.slug, isKids: false))
                                    } label: {
                                        HStack {
                                            Text(program.video.title)
                                                .font(.headline)
                                            Spacer()
                                            Text(program.startsAt)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .focusSection()
                        }
                    }
                    .padding(70)
                }
            }

        case .playlist:
            if let playlist = model.playlist {
                ScrollView {
                    VStack(alignment: .leading, spacing: 34) {
                        heroHeader(
                            title: playlist.playlist.name,
                            subtitle: playlist.channel.name,
                            description: playlist.playlist.description
                        )

                        if playlist.items.isEmpty {
                            ContentUnavailableView(
                                "Playlist is empty",
                                systemImage: "rectangle.stack",
                                description: Text("This playlist has no playable videos.")
                            )
                        } else {
                            LazyVGrid(
                                columns: [GridItem(.adaptive(minimum: 360), spacing: 28)],
                                spacing: 30
                            ) {
                                ForEach(playlist.items) { item in
                                    TVContentCard(
                                        title: item.video.title,
                                        subtitle: playlist.channel.name,
                                        artworkObjectKey: item.video.thumbnail?.objectKey,
                                        progress: nil
                                    ) {
                                        router.open(.video(slug: item.video.slug, isKids: false))
                                    }
                                }
                            }
                            .focusSection()
                        }
                    }
                    .padding(70)
                }
            }

        case .movie:
            if let movie = model.movie {
                ScrollView {
                    VStack(alignment: .leading, spacing: 32) {
                        heroHeader(
                            title: movie.title,
                            subtitle: TVStrings.movieMetadata(year: movie.releaseYear, rating: movie.maturityRating,
                                                              minutes: movie.runtimeMinutes),
                            description: movie.synopsis
                        )

                        HStack(spacing: 24) {
                            if let primary = movie.primaryVideo {
                                Button {
                                    router.play(.video(slug: primary.slug, isKids: false))
                                } label: {
                                    Label("Play Movie", systemImage: "play.fill")
                                }
                                .buttonStyle(.borderedProminent)
                            }

                            if let trailer = movie.trailerVideo {
                                Button {
                                    router.play(.video(slug: trailer.slug, isKids: false))
                                } label: {
                                    Label("Trailer", systemImage: "film")
                                }
                            }
                        }
                    }
                    .padding(70)
                }
            }

        case .series:
            if let series = model.series {
                ScrollView {
                    VStack(alignment: .leading, spacing: 34) {
                        heroHeader(
                            title: series.title,
                            subtitle: seriesSubtitle(series),
                            description: series.synopsis
                        )

                        ForEach(series.seasons) { season in
                            VStack(alignment: .leading, spacing: 20) {
                                Text(TVStrings.seasonTitle(season.title, number: season.seasonNumber))
                                    .font(.title2.bold())
                                ScrollView(.horizontal, showsIndicators: false) {
                                    LazyHStack(spacing: 24) {
                                        ForEach(season.episodes) { episode in
                                            Button {
                                                router.play(.video(slug: episode.video.slug, isKids: false))
                                            } label: {
                                                VStack(alignment: .leading, spacing: 10) {
                                                    RoundedRectangle(cornerRadius: 18)
                                                        .fill(.gray.opacity(0.2))
                                                        .frame(width: 360, height: 202)
                                                        .overlay {
                                                            Image(systemName: "play.fill")
                                                                .font(.system(size: 42))
                                                        }
                                                    Text("\(episode.episodeNumber). \(episode.title)")
                                                        .font(.headline)
                                                        .lineLimit(1)
                                                        .frame(width: 360, alignment: .leading)
                                                    Text(episode.synopsis)
                                                        .font(.caption)
                                                        .foregroundStyle(.secondary)
                                                        .lineLimit(2)
                                                        .frame(width: 360, alignment: .leading)
                                                }
                                            }
                                            .buttonStyle(.card)
                                        }
                                    }
                                    .padding(.vertical, 8)
                                }
                                .focusSection()
                            }
                        }
                    }
                    .padding(70)
                }
            }

        case .live:
            EmptyView()
        }
    }

    @ViewBuilder
    private func hero(
        title: String,
        subtitle: String?,
        description: String?,
        play: @escaping () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 30) {
            heroHeader(title: title, subtitle: subtitle, description: description)
            Button(action: play) {
                Label("Play", systemImage: "play.fill")
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(70)
    }

    private func heroHeader(title: String, subtitle: String?, description: String?) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(title)
                .font(.largeTitle.bold())
            if let subtitle {
                Text(subtitle)
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
            if let description, !description.isEmpty {
                Text(description)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: 1100, alignment: .leading)
            }
        }
    }

    private func seriesSubtitle(_ series: TVSeriesResponse.Series) -> String {
        [series.releaseYear.map(String.init), series.maturityRating]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    private func programSection(
        _ heading: String,
        program: TVCreatorTVResponse.Schedule.Program
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(heading)
                .font(.headline)
                .foregroundStyle(.secondary)
            Text(program.video.title)
                .font(.title2.bold())
            if let description = program.video.description {
                Text(description)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }
        }
    }
}
