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
        let menuState = MenuState(context: model.controlContext, playback: model.playback,
                                  selectedCaptionId: model.selectedCaptionId)
        // Subtitle cue updates must not rebuild a menu while the remote is navigating it.
        if context.coordinator.menuState != menuState {
            context.coordinator.menuState = menuState
            controller.transportBarCustomMenuItems = transportMenus()
        }
    }

    private func transportMenus() -> [UIMenuElement] {
        guard let context = model.controlContext, let playback = model.playback else { return [] }
        var menus = subtitleMenus(context: context)

        if !playback.isLive, !playback.chapters.isEmpty {
            menus.append(UIMenu(
                title: TVStrings.text("Chapters"),
                image: UIImage(systemName: "list.bullet"),
                children: playback.chapters.map { chapter in
                    UIAction(title: chapter.title) { _ in
                        Task { @MainActor in await model.seekChapter(chapter.id, context: context) }
                    }
                }
            ))
        }

        if playback.nextEpisodeDestination != nil, let next = playback.nextEpisode {
            menus.append(UIMenu(
                title: TVStrings.text("Next Episode"),
                image: UIImage(systemName: "forward.end.fill"),
                children: [UIAction(title: next.title) { _ in
                    Task { @MainActor in await model.playNextEpisode(context: context) }
                }]
            ))
        }
        return menus
    }

    private func subtitleMenus(context: TVPlaybackControlContext) -> [UIMenuElement] {
        guard !model.captionTracks.isEmpty else { return [] }

        let off = UIAction(
            title: TVStrings.text("Off"),
            state: model.selectedCaptionId == nil ? .on : .off
        ) { _ in
            Task { @MainActor in await model.selectCaption(nil, context: context) }
        }

        let actions = model.captionTracks.map { track in
            UIAction(
                title: "\(track.label) · \(track.language)",
                state: model.selectedCaptionId == track.id ? .on : .off
            ) { _ in
                Task { @MainActor in await model.selectCaption(track.id, context: context) }
            }
        }

        return [
            UIMenu(
                title: TVStrings.text("Subtitles"),
                image: UIImage(systemName: "captions.bubble"),
                options: [.singleSelection],
                children: [off] + actions
            )
        ]
    }

    struct MenuState: Equatable {
        let context: TVPlaybackControlContext?
        let playback: TVPlaybackAsset?
        let selectedCaptionId: String?
    }

    @MainActor
    final class Coordinator: NSObject, AVPlayerViewControllerDelegate {
        var subtitleLabel: UILabel?
        weak var model: TVPlayerViewModel?
        var menuState: MenuState?

        init(model: TVPlayerViewModel) {
            self.model = model
        }

        func playerViewControllerWillStartPictureInPicture(
            _ playerViewController: AVPlayerViewController
        ) {
            let player = playerViewController.player
            let context = model?.controlContext
            Task { @MainActor [weak self] in
                guard let model = self?.model, let context,
                      model.controlContext == context, model.player === player else { return }
                model.setPictureInPictureActive(true)
            }
        }

        func playerViewControllerDidStopPictureInPicture(
            _ playerViewController: AVPlayerViewController
        ) {
            let player = playerViewController.player
            let context = model?.controlContext
            Task { @MainActor [weak self] in
                guard let model = self?.model, let context,
                      model.controlContext == context, model.player === player else { return }
                model.setPictureInPictureActive(false)
            }
        }

        func playerViewController(
            _ playerViewController: AVPlayerViewController,
            failedToStartPictureInPictureWithError error: Error
        ) {
            let player = playerViewController.player
            let context = model?.controlContext
            Task { @MainActor [weak self] in
                guard let model = self?.model, let context,
                      model.controlContext == context, model.player === player else { return }
                model.setPictureInPictureActive(false)
            }
        }

        func playerViewController(
            _ playerViewController: AVPlayerViewController,
            willResumePlaybackAfterUserNavigatedFrom oldTime: CMTime,
            to targetTime: CMTime
        ) {
            let player = playerViewController.player
            let item = player?.currentItem
            let context = model?.controlContext
            Task { @MainActor [weak self] in
                guard let model = self?.model, let context, model.player === player,
                      player?.currentItem === item else { return }
                model.noteUserNavigation(to: targetTime, context: context)
            }
        }
    }
}
