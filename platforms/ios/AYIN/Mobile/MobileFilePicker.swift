import UIKit
import PhotosUI
import UniformTypeIdentifiers

/// Owns one system-picker result. No file URL or file bytes are exposed as bridge data.
@MainActor
final class MobileFilePicker: NSObject, UIDocumentPickerDelegate, PHPickerViewControllerDelegate {
    private weak var owner: UIViewController?
    private var completion: (([URL]?) -> Void)?
    private var generation = UUID()
    private var scopedSource: URL?
    private var videoOnly = false
    init(owner: UIViewController) { self.owner = owner }

    func open(videoOnly: Bool, completion: @escaping ([URL]?) -> Void) {
        guard self.completion == nil, let owner, owner.presentedViewController == nil else { completion(nil); return }
        self.videoOnly = videoOnly; self.completion = completion; generation = UUID()
        let sheet = UIAlertController(title: videoOnly ? "Choose video / اختر فيديو" : "Choose file / اختر ملف", message: nil, preferredStyle: .actionSheet)
        if videoOnly {
            let inbox = SharedVideoInbox.selectionStorage()
            if let pending = inbox.pending(), let file = try? inbox.file(for: pending) {
                sheet.addAction(UIAlertAction(title: "Shared video / الفيديو المشترك", style: .default) { [weak self] _ in self?.deliver(file) })
                sheet.addAction(UIAlertAction(title: "Discard saved video / حذف الفيديو المحفوظ", style: .destructive) { [weak self] _ in
                    inbox.clear(); self?.finish(nil)
                })
            } else if let source = inbox.recoverySource() {
                sheet.addAction(UIAlertAction(title: "Previous video / الفيديو السابق", style: .default) { [weak self] _ in self?.deliver(source) })
            }
        }
        sheet.addAction(UIAlertAction(title: "Photos / الصور", style: .default) { [weak self] _ in self?.photos() })
        sheet.addAction(UIAlertAction(title: "Files / الملفات", style: .default) { [weak self] _ in self?.files() })
        sheet.addAction(UIAlertAction(title: "Cancel / إلغاء", style: .cancel) { [weak self] _ in self?.finish(nil) })
        sheet.popoverPresentationController?.sourceView = owner.view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: owner.view.bounds.midX, y: owner.view.bounds.midY, width: 1, height: 1)
        owner.present(sheet, animated: true)
    }
    private func files() {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: videoOnly ? [.movie] : [.item], asCopy: false)
        picker.allowsMultipleSelection = false; picker.delegate = self
        owner?.present(picker, animated: true)
    }
    private func photos() {
        var config = PHPickerConfiguration(photoLibrary: .shared())
        config.selectionLimit = 1; config.preferredAssetRepresentationMode = .current
        config.filter = videoOnly ? .videos : .any(of: [.images, .videos])
        let picker = PHPickerViewController(configuration: config); picker.delegate = self
        owner?.present(picker, animated: true)
    }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finish(nil) }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first else { finish(nil); return }
        if videoOnly && !SharedVideoInbox.validVideoExtension(url.pathExtension) { finish(nil); return }
        deliver(url)
    }
    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let provider = results.first?.itemProvider else { finish(nil); return }
        let lease = generation
        guard let identifier = provider.registeredTypeIdentifiers.first(where: {
            guard let type = UTType($0) else { return false }
            return type.conforms(to: .movie) || (!videoOnly && type.conforms(to: .image))
        }) else { finish(nil); return }
        provider.loadFileRepresentation(forTypeIdentifier: identifier) { [weak self] url, error in
            // Copy the provider's temporary representation before returning its callback.
            var owned: URL?
            if error == nil, let url {
                let inbox = SharedVideoInbox.selectionStorage()
                if UTType(identifier)?.conforms(to: .movie) == true,
                   let record = try? inbox.importVideo(url) {
                    owned = try? inbox.file(for: record)
                } else if UTType(identifier)?.conforms(to: .image) == true,
                          let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 25 * 1024 * 1024 {
                    let target = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
                        .appendingPathExtension(UTType(identifier)?.preferredFilenameExtension ?? "jpg")
                    if (try? FileManager.default.copyItem(at: url, to: target)) != nil { owned = target }
                }
            }
            let result = owned
            Task { @MainActor in
                guard let self, self.generation == lease else {
                    if let result { SharedVideoInbox.selectionStorage().discardOwnedFile(result) }
                    return
                }
                if let result { self.deliver(result) } else { self.finish(nil) }
            }
        }
    }
    private func deliver(_ url: URL) {
        scopedSource?.stopAccessingSecurityScopedResource(); scopedSource = nil
        if url.startAccessingSecurityScopedResource() { scopedSource = url }
        guard FileManager.default.fileExists(atPath: url.path) else { finish(nil); return }
        if SharedVideoInbox.validVideoExtension(url.pathExtension) { try? SharedVideoInbox.selectionStorage().remember(url) }
        finish([url])
    }
    private func finish(_ urls: [URL]?) {
        let callback = completion; completion = nil; callback?(urls)
    }
    func cancel() {
        generation = UUID(); finish(nil)
        scopedSource?.stopAccessingSecurityScopedResource(); scopedSource = nil
        if owner?.presentedViewController is UIDocumentPickerViewController || owner?.presentedViewController is PHPickerViewController {
            owner?.dismiss(animated: false)
        }
    }
}
