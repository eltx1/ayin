import AVFoundation
import AVKit
import SwiftUI
import UIKit

struct TVPlayerController: UIViewControllerRepresentable {
    @ObservedObject var model: TVPlayerViewModel

    func makeCoordinator() -> Coordinator { Coordinator(model: model) }

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.delegate = context.coordinator
        controller.showsPlaybackControls = true
        controller.playbackControlsIncludeTransportBar = true
        controller.playbackControlsIncludeInfoViews = true
        controller.transportBarIncludesTitleView = true
        controller.allowsPictureInPicturePlayback = true

        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.numberOfLines = 3
        label.textAlignment = .center
        label.textColor = .white
        label.font = .preferredFont(forTextStyle: .title2)
        label.backgroundColor = UIColor.black.withAlphaComponent(0.65)
        label.layer.cornerRadius = 8
        label.clipsToBounds = true
        label.isHidden = true

        if let overlay = controller.contentOverlayView {
            overlay.addSubview(label)
            NSLayoutConstraint.activate([
                label.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
                label.leadingAnchor.constraint(greaterThanOrEqualTo: overlay.leadingAnchor, constant: 100),
                label.trailingAnchor.constraint(lessThanOrEqualTo: overlay.trailingAnchor, constant: -100),
                label.bottomAnchor.constraint(equalTo: overlay.bottomAnchor, constant: -110)
            ])
        }
        context.coordinator.subtitleLabel = label
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        context.coordinator.model = model
        controller.player = model.player
        context.coordinator.subtitleLabel?.text = model.subtitleText
        context.coordinator.subtitleLabel?.isHidden = model.subtitleText.isEmpty
        controller.transportBarCustomMenuItems = subtitleMenus()
    }

    private func subtitleMenus() -> [UIMenuElement] {
        guard !model.captionTracks.isEmpty else { return [] }

        let off = UIAction(
            title: "Off",
            state: model.selectedCaptionId == nil ? .on : .off
        ) { _ in
            Task { @MainActor in await model.selectCaption(nil) }
        }

        let actions = model.captionTracks.map { track in
            UIAction(
                title: "\(track.label) · \(track.language)",
                state: model.selectedCaptionId == track.id ? .on : .off
            ) { _ in
                Task { @MainActor in await model.selectCaption(track.id) }
            }
        }

        return [
            UIMenu(
                title: "Subtitles",
                image: UIImage(systemName: "captions.bubble"),
                options: [.singleSelection],
                children: [off] + actions
            )
        ]
    }

    final class Coordinator: NSObject, AVPlayerViewControllerDelegate {
        var subtitleLabel: UILabel?
        weak var model: TVPlayerViewModel?

        init(model: TVPlayerViewModel) {
            self.model = model
        }

        func playerViewControllerWillStartPictureInPicture(
            _ playerViewController: AVPlayerViewController
        ) {
            model?.setPictureInPictureActive(true)
        }

        func playerViewControllerDidStopPictureInPicture(
            _ playerViewController: AVPlayerViewController
        ) {
            model?.setPictureInPictureActive(false)
        }

        func playerViewController(
            _ playerViewController: AVPlayerViewController,
            failedToStartPictureInPictureWithError error: Error
        ) {
            model?.setPictureInPictureActive(false)
        }

        func playerViewController(
            _ playerViewController: AVPlayerViewController,
            willResumePlaybackAfterUserNavigatedFrom oldTime: CMTime,
            to targetTime: CMTime
        ) {
            model?.noteUserNavigation(to: targetTime)
        }
    }
}
