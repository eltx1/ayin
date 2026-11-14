import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let status = UILabel()
    private let done = UIButton(type: .system)
    private var started = false
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        status.text = "Preparing your video… / جارٍ تجهيز الفيديو…"
        status.numberOfLines = 0; status.textAlignment = .center
        done.setTitle("Done / تم", for: .normal)
        done.addTarget(self, action: #selector(finish), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [status, done])
        stack.axis = .vertical; stack.spacing = 24
        stack.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(stack)
        NSLayoutConstraint.activate([stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24)])
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !started else { return }; started = true
        let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        let providers = items.flatMap { $0.attachments ?? [] }
        guard providers.count == 1, let provider = providers.first,
              let identifier = provider.registeredTypeIdentifiers.first(where: { UTType($0)?.conforms(to: .movie) == true }) else {
            status.text = "Share one video at a time. / شارك فيديو واحدًا في كل مرة."; return
        }
        done.isEnabled = false
        provider.loadFileRepresentation(forTypeIdentifier: identifier) { [weak self] url, error in
            // The temporary URL is valid only during this callback. Import synchronously.
            let result: String
            do {
                guard error == nil, let url else { throw SharedVideoInbox.InboxError.unavailable }
                let inbox = try SharedVideoInbox.shared()
                _ = try inbox.importVideo(url)
                result = "Saved locally. Open AYIN, sign in, then choose the shared video on Upload. Nothing has been uploaded yet.\nتم الحفظ محليًا. افتح AYIN وسجّل الدخول ثم اختر الفيديو المشترك في صفحة الرفع. لم يُرفع أي شيء بعد."
            } catch SharedVideoInbox.InboxError.full {
                result = "A video is already waiting in AYIN. Open AYIN to use or discard it first.\nيوجد فيديو محفوظ بالفعل. افتح AYIN لاستخدامه أو حذفه أولًا."
            } catch {
                result = "Couldn't save this video. Use a video file up to 2 GB and try again.\nتعذّر حفظ الفيديو. استخدم ملف فيديو لا يتجاوز ٢ جيجابايت وحاول مجددًا."
            }
            DispatchQueue.main.async { self?.status.text = result; self?.done.isEnabled = true }
        }
    }
    @objc private func finish() { extensionContext?.completeRequest(returningItems: nil) }
}
