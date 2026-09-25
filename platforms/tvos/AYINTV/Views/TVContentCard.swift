import SwiftUI

struct TVContentCard: View {
    let title: String
    let subtitle: String?
    let artworkObjectKey: String?
    let progress: DiscoveryItem.Progress?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 10) {
                ZStack(alignment: .bottomLeading) {
                    AsyncImage(url: artworkURL) { phase in
                        switch phase {
                        case let .success(image):
                            image.resizable().scaledToFill()
                        default:
                            RoundedRectangle(cornerRadius: 18)
                                .fill(.gray.opacity(0.22))
                                .overlay {
                                    Image(systemName: "play.rectangle")
                                        .font(.system(size: 42))
                                        .foregroundStyle(.secondary)
                                }
                        }
                    }
                    .frame(width: 360, height: 202)
                    .clipShape(RoundedRectangle(cornerRadius: 18))

                    if let progress, progress.completedAt == nil {
                        GeometryReader { proxy in
                            let fraction = min(1, max(0, Double(progress.positionMs) / 7_200_000))
                            Rectangle()
                                .frame(width: proxy.size.width * fraction, height: 7)
                                .frame(maxHeight: .infinity, alignment: .bottom)
                        }
                        .frame(width: 360, height: 202)
                    }
                }

                Text(title)
                    .font(.headline)
                    .lineLimit(1)
                    .frame(width: 360, alignment: .leading)

                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .frame(width: 360, alignment: .leading)
                }
            }
        }
        .buttonStyle(.card)
    }

    private var artworkURL: URL? {
        guard let artworkObjectKey else { return nil }
        return MediaURLBuilder.url(objectKey: artworkObjectKey)
    }
}
