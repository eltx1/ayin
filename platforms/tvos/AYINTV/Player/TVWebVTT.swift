import Foundation

struct TVCaptionCue: Equatable {
    let startMs: Int
    let endMs: Int
    let text: String

    func contains(_ positionMs: Int) -> Bool {
        startMs <= positionMs && positionMs < endMs
    }
}

enum TVWebVTT {
    static func parse(_ source: String) -> [TVCaptionCue] {
        let normalized = source
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        return normalized
            .components(separatedBy: "\n\n")
            .compactMap(parseBlock)
            .sorted { $0.startMs < $1.startMs }
    }

    private static func parseBlock(_ block: String) -> TVCaptionCue? {
        let lines = block
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map(String.init)
        guard !lines.isEmpty, lines[0] != "WEBVTT", !lines[0].hasPrefix("NOTE") else { return nil }
        guard let timingIndex = lines.firstIndex(where: { $0.contains("-->") }) else { return nil }
        let timing = lines[timingIndex].components(separatedBy: "-->")
        guard timing.count == 2 else { return nil }
        let endToken = timing[1].trimmingCharacters(in: .whitespaces).split(separator: " ").first.map(String.init) ?? ""
        guard
            let start = timestampMs(timing[0].trimmingCharacters(in: .whitespaces)),
            let end = timestampMs(endToken),
            end > start
        else { return nil }
        let text = lines.dropFirst(timingIndex + 1).joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        return TVCaptionCue(startMs: start, endMs: end, text: stripTags(text))
    }

    private static func timestampMs(_ raw: String) -> Int? {
        let parts = raw.components(separatedBy: ":")
        guard parts.count == 2 || parts.count == 3 else { return nil }
        let secondsPart = parts.last?.components(separatedBy: ".") ?? []
        guard
            secondsPart.count == 2,
            let seconds = Int(secondsPart[0]),
            let millisRaw = Int(secondsPart[1])
        else { return nil }
        let digits = secondsPart[1].count
        let millis = digits == 1 ? millisRaw * 100 : digits == 2 ? millisRaw * 10 : millisRaw
        let minutesIndex = parts.count - 2
        guard let minutes = Int(parts[minutesIndex]) else { return nil }
        let hours = parts.count == 3 ? Int(parts[0]) ?? 0 : 0
        return (((hours * 60) + minutes) * 60 + seconds) * 1_000 + min(millis, 999)
    }

    private static func stripTags(_ text: String) -> String {
        text.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
    }
}
