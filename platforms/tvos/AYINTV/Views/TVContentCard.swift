import SwiftUI

struct TVContentCard: View {
    let title: String
    let subtitle: String?
    let artworkObjectKey: String?
    let progress: TVDiscoveryItem.Progress?
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

                    if let progress, progress.completedAt == nil, progress.positionMs > 0 {
                        Label(resumePosition(progress.positionMs), systemImage: "clock.arrow.circlepath")
                            .font(.caption.bold())
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(.ultraThinMaterial, in: Capsule())
                            .padding(12)
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

    private func resumePosition(_ milliseconds: Int) -> String {
        let seconds = max(0, milliseconds / 1_000)
        let hours = seconds / 3_600
        let minutes = (seconds % 3_600) / 60
        let remainingSeconds = seconds % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d watched", hours, minutes, remainingSeconds)
        }
        return String(format: "%d:%02d watched", minutes, remainingSeconds)
    }

    private var artworkURL: URL? {
        guard let artworkObjectKey else { return nil }
        return MediaURLBuilder.url(objectKey: artworkObjectKey)
    }
}
