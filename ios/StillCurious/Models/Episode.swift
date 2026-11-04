import Foundation

struct ReadingSource: Codable, Hashable, Identifiable {
    let title: String
    let url: String
    var id: String { url }
    var linkURL: URL? { AppConfiguration.validatedHTTPSURL(url) }
}

struct Episode: Codable, Hashable, Identifiable {
    let id: String
    let title: String
    let overview: String
    let durationSeconds: Double
    let audioUrl: String
    let category: String?
    let kind: String
    let theme: String
    let readingList: [ReadingSource]
    let readingNote: String

    var durationLabel: String {
        let seconds = max(0, Int(durationSeconds.rounded()))
        return seconds >= 60 ? "\(seconds / 60) min" : "\(seconds) sec"
    }

    var kindLabel: String {
        kind == "voice_preview" ? "Voice preview" : "Episode excerpt"
    }

    /// The included library plays offline. Remote episodes must use the configured HTTPS origin.
    func audioURL(configuration: AppConfiguration, bundle: Bundle = .main) -> URL? {
        guard let relative = URLComponents(string: audioUrl),
              relative.scheme == nil, relative.host == nil,
              relative.query == nil, relative.fragment == nil,
              relative.path.hasPrefix("/audio/"), relative.path.hasSuffix(".mp3"),
              !relative.path.contains(".."), !relative.path.contains("%") else { return nil }
        let name = (relative.path as NSString).lastPathComponent
        let stem = (name as NSString).deletingPathExtension
        if let bundled = bundle.url(forResource: stem, withExtension: "mp3", subdirectory: "audio")
            ?? bundle.url(forResource: stem, withExtension: "mp3") {
            return bundled
        }
        return URL(string: relative.path, relativeTo: configuration.serverOrigin)?.absoluteURL
    }

    static func loadLibrary(bundle: Bundle = .main) throws -> [Episode] {
        guard let url = bundle.url(forResource: "library", withExtension: "json") else {
            throw LibraryError.missingCatalog
        }
        let episodes = try JSONDecoder().decode([Episode].self, from: Data(contentsOf: url))
        guard Set(episodes.map(\.id)).count == episodes.count,
              episodes.allSatisfy({ !$0.id.isEmpty && !$0.title.isEmpty && $0.durationSeconds.isFinite && $0.durationSeconds > 0 }) else {
            throw LibraryError.invalidCatalog
        }
        return episodes
    }

    enum LibraryError: LocalizedError {
        case missingCatalog, invalidCatalog
        var errorDescription: String? { "The listening library could not be loaded. Please update the app and try again." }
    }
}
