import Foundation
import UniformTypeIdentifiers

/// Local handoff only. No authentication cookies, API keys or upload authority are
/// shared with the extension, and file bytes never pass through the JS bridge.
struct SharedVideoInbox {
    static let appGroup = "group.net.ayin.app.ios.sharing"
    static let maximumBytes: Int64 = 2 * 1024 * 1024 * 1024
    static let retention: TimeInterval = 24 * 60 * 60
    struct Record: Codable {
        let fileName: String
        let originalName: String
        let createdAt: Date
    }
    private struct Recovery: Codable { let bookmark: Data; let createdAt: Date }
    enum InboxError: Error { case unavailable, unsupported, tooLarge, empty, full, invalid }
    let directory: URL
    private let byteLimit: Int64
    init(directory: URL, byteLimit: Int64 = SharedVideoInbox.maximumBytes) { self.directory = directory; self.byteLimit = byteLimit }
    static func shared() throws -> Self {
        guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else { throw InboxError.unavailable }
        return Self(directory: root.appendingPathComponent("VideoInbox", isDirectory: true))
    }
    static func applicationStorage() -> Self {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return Self(directory: root.appendingPathComponent("UploadSources", isDirectory: true))
    }
    static func selectionStorage() -> Self { (try? shared()) ?? applicationStorage() }
    static func clearUploadSources() { try? shared().clear(); applicationStorage().clear() }
    static func validVideoExtension(_ value: String) -> Bool {
        guard let type = UTType(filenameExtension: value.lowercased()) else { return false }
        return type.conforms(to: .movie)
    }
    static func validStoredName(_ value: String) -> Bool {
        let pieces = value.split(separator: ".", omittingEmptySubsequences: false)
        return pieces.count == 2 && UUID(uuidString: String(pieces[0])) != nil && validVideoExtension(String(pieces[1]))
    }
    private var manifest: URL { directory.appendingPathComponent("pending.json") }
    private var bookmark: URL { directory.appendingPathComponent("recovery.json") }
    private func record() -> Record? {
        guard let bytes = try? Data(contentsOf: manifest), bytes.count <= 8192,
              let value = try? JSONDecoder().decode(Record.self, from: bytes),
              Self.validStoredName(value.fileName), value.originalName.count <= 240 else { return nil }
        return value
    }
    func pending(now: Date = Date()) -> Record? {
        guard let value = record() else { return nil }
        guard now.timeIntervalSince(value.createdAt) >= 0,
              now.timeIntervalSince(value.createdAt) < Self.retention else {
            try? FileManager.default.removeItem(at: file(for: value))
            try? FileManager.default.removeItem(at: manifest)
            return nil
        }
        guard
              FileManager.default.fileExists(atPath: directory.appendingPathComponent(value.fileName).path) else { return nil }
        return value
    }
    func file(for record: Record) throws -> URL {
        guard Self.validStoredName(record.fileName) else { throw InboxError.invalid }
        return directory.appendingPathComponent(record.fileName)
    }
    /// Provider URLs can disappear immediately after loadFileRepresentation returns.
    /// Import inside that callback with bounded streaming, then publish atomically.
    @discardableResult
    func importVideo(_ source: URL, now: Date = Date()) throws -> Record {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var localDirectory = directory
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try localDirectory.setResourceValues(values)
        let coordinator = NSFileCoordinator(filePresenter: nil)
        var coordinationError: NSError?
        var result: Result<Record, Error>?
        coordinator.coordinate(writingItemAt: directory, options: .forMerging, error: &coordinationError) { _ in
            result = Result { try importCoordinatedVideo(source, now: now) }
        }
        if let coordinationError { throw coordinationError }
        guard let result else { throw InboxError.unavailable }
        return try result.get()
    }
    private func importCoordinatedVideo(_ source: URL, now: Date) throws -> Record {
        guard source.isFileURL, Self.validVideoExtension(source.pathExtension) else { throw InboxError.unsupported }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        // Recover interrupted extension imports; only UUID-owned partial files are touched.
        for partial in (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? [] {
            if partial.pathExtension == "partial", Self.validStoredName(partial.deletingPathExtension().lastPathComponent) {
                try? FileManager.default.removeItem(at: partial)
            }
        }
        // Never overwrite a source that WebKit may still be reading.
        if pending(now: now) != nil { throw InboxError.full }
        if let expired = record() {
            try? FileManager.default.removeItem(at: file(for: expired))
            try? FileManager.default.removeItem(at: manifest)
        }
        let name = UUID().uuidString + "." + source.pathExtension.lowercased()
        let partial = directory.appendingPathComponent(name + ".partial")
        let destination = directory.appendingPathComponent(name)
        FileManager.default.createFile(atPath: partial.path, contents: nil,
                                       attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        defer { try? FileManager.default.removeItem(at: partial) }
        let input = try FileHandle(forReadingFrom: source)
        let output = try FileHandle(forWritingTo: partial)
        var written: Int64 = 0
        do {
            while let bytes = try input.read(upToCount: 1024 * 1024), !bytes.isEmpty {
                written += Int64(bytes.count)
                guard written <= byteLimit else { throw InboxError.tooLarge }
                try output.write(contentsOf: bytes)
            }
            guard written > 0 else { throw InboxError.empty }
            try output.synchronize()
            try input.close(); try output.close()
            try FileManager.default.moveItem(at: partial, to: destination)
            let value = Record(fileName: name, originalName: String(source.lastPathComponent.prefix(240)), createdAt: now)
            try JSONEncoder().encode(value).write(to: manifest, options: .atomic)
            return value
        } catch {
            try? input.close(); try? output.close()
            try? FileManager.default.removeItem(at: partial)
            try? FileManager.default.removeItem(at: destination)
            throw error
        }
    }
    /// Bookmark resolution can fail when the provider revokes/removes a file.
    /// Caller must then offer reselection; no promise of unlimited provider access.
    func remember(_ source: URL, now: Date = Date()) throws {
        guard source.isFileURL, Self.validVideoExtension(source.pathExtension) else { throw InboxError.unsupported }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var localDirectory = directory
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try localDirectory.setResourceValues(values)
        let data = try source.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
        guard data.count <= 65_536 else { throw InboxError.invalid }
        try JSONEncoder().encode(Recovery(bookmark: data, createdAt: now)).write(to: bookmark, options: .atomic)
    }
    func recoverySource(now: Date = Date()) -> URL? {
        guard let bytes = try? Data(contentsOf: bookmark), bytes.count <= 100_000,
              let recovery = try? JSONDecoder().decode(Recovery.self, from: bytes),
              now.timeIntervalSince(recovery.createdAt) >= 0,
              now.timeIntervalSince(recovery.createdAt) < Self.retention else {
            try? FileManager.default.removeItem(at: bookmark)
            return nil
        }
        var stale = false
        guard let url = try? URL(resolvingBookmarkData: recovery.bookmark, options: .withoutUI, relativeTo: nil, bookmarkDataIsStale: &stale),
              !stale, url.isFileURL, Self.validVideoExtension(url.pathExtension) else { return nil }
        return url
    }
    func clear() {
        // Only this app's fixed, private inbox is removed. Never delete provider files.
        try? FileManager.default.removeItem(at: directory)
    }
    func discardOwnedFile(_ file: URL) {
        guard file.deletingLastPathComponent().standardizedFileURL == directory.standardizedFileURL,
              Self.validStoredName(file.lastPathComponent) else { return }
        if record()?.fileName == file.lastPathComponent { try? FileManager.default.removeItem(at: manifest) }
        try? FileManager.default.removeItem(at: file)
    }
}
