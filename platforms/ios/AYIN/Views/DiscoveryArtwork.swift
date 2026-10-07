import SwiftUI

struct DiscoveryArtwork: View {
    let artworkObjectKey: String?
    let type: String

    var body: some View {
        AsyncImage(url: artworkURL) { phase in
            Content(phase: phase, type: type)
        }
        .accessibilityHidden(true)
    }

    var artworkURL: URL? {
        guard let artworkObjectKey else { return nil }
        return MediaURLBuilder.url(objectKey: artworkObjectKey)
    }

    struct Content: View {
        let phase: AsyncImagePhase
        let type: String

        var body: some View {
            Group {
                switch phase {
                case let .success(image):
                    image.resizable().scaledToFill()
                default:
                    RoundedRectangle(cornerRadius: 14)
                        .fill(.quaternary)
                        .overlay {
                            Image(systemName: type == "VIDEO" ? "play.fill" : "sparkles.tv")
                                .font(.largeTitle)
                                .foregroundStyle(.secondary)
                        }
                }
            }
            .frame(width: 210, height: 118)
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }
}
