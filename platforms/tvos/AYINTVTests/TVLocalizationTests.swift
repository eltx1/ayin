import XCTest
@testable import AYINTV

final class TVLocalizationTests: XCTestCase {
    func testEnglishAndArabicTablesArePackagedWithMatchingKeysAndFormats() throws {
        let english = try strings(for: "en")
        let arabic = try strings(for: "ar")
        XCTAssertEqual(Set(english.keys), Set(arabic.keys))
        XCTAssertTrue(requiredKeys.isSubset(of: Set(english.keys)))
        let placeholders = try NSRegularExpression(pattern: "%[0-9]*[d@]")

        for (key, fallback) in english {
            XCTAssertEqual(fallback, key, "English fallback changed for \(key)")
            let translation = try XCTUnwrap(arabic[key], key)
            XCTAssertFalse(translation.isEmpty, key)
            XCTAssertNotEqual(translation, key, "Arabic translation missing for \(key)")
            XCTAssertEqual(formats(in: translation, using: placeholders), formats(in: key, using: placeholders),
                           "Format arguments differ for \(key)")
        }
    }

    func testSystemAppLanguageSupportsRegionalArabicAndEnglishFallback() {
        let languages = Bundle.main.localizations
        XCTAssertTrue(languages.contains("en"))
        XCTAssertTrue(languages.contains("ar"))
        XCTAssertEqual(Bundle.main.developmentLocalization, "en")
        for preference in ["ar", "ar-EG", "ar-SA"] {
            XCTAssertEqual(Bundle.preferredLocalizations(from: languages, forPreferences: [preference]).first, "ar")
        }
        XCTAssertEqual(Bundle.preferredLocalizations(from: languages, forPreferences: ["en-GB"]).first, "en")
        XCTAssertEqual(Bundle.preferredLocalizations(from: languages, forPreferences: ["fr-FR", "en-US"]).first, "en")
        XCTAssertEqual(Locale.Language(identifier: "ar").characterDirection, .rightToLeft)
    }

    func testDynamicControlsLocalizeBothBranches() throws {
        let arabic = try languageBundle("ar")
        XCTAssertEqual(TVStrings.moreTitle(isLoading: false, bundle: arabic), "المزيد")
        XCTAssertEqual(TVStrings.moreTitle(isLoading: true, bundle: arabic), "جارٍ التحميل…")
        XCTAssertEqual(TVStrings.moreResultsTitle(isLoading: false, bundle: arabic), "المزيد من النتائج")
        XCTAssertEqual(TVStrings.moreResultsTitle(isLoading: true, bundle: arabic), "جارٍ التحميل…")
        XCTAssertEqual(TVStrings.searchPrompt(isKids: true, bundle: arabic), "ابحث في قسم الأطفال على AYIN")
        XCTAssertEqual(TVStrings.searchPrompt(isKids: false, bundle: arabic), "أفلام، مسلسلات، مبدعون، فيديوهات")
        XCTAssertEqual(TVStrings.progressReviewTitle(isReviewing: true, bundle: arabic), "جارٍ المراجعة…")
        XCTAssertEqual(TVStrings.progressReviewTitle(isReviewing: false, bundle: arabic), "مراجعة تقدّم المشاهدة المحفوظ")
        XCTAssertEqual(TVStrings.videoDescription(protocolName: "HLS", bundle: arabic), "تشغيل HLS بجودة متكيّفة")
        XCTAssertEqual(TVStrings.videoDescription(protocolName: "MP4", bundle: arabic), "فيديو")
        XCTAssertEqual(TVStrings.creatorTVDescription(state: "ON_AIR", status: "ACTIVE", bundle: arabic), "على الهواء")

        let english = try languageBundle("en")
        XCTAssertEqual(TVStrings.moreTitle(isLoading: true, bundle: english), "Loading…")
        XCTAssertEqual(TVStrings.searchPrompt(isKids: true, bundle: english), "Search Kids on AYIN")
        XCTAssertEqual(TVStrings.progressReviewTitle(isReviewing: false, bundle: english), "Review saved progress")
    }

    func testUIKitPlayerMenuTitlesAndAppOwnedErrorsAreLocalized() throws {
        let arabic = try languageBundle("ar")
        for (key, expected) in [
            "Off": "إيقاف", "Subtitles": "الترجمات", "Chapters": "الفصول", "Next Episode": "الحلقة التالية",
            "Live": "مباشر", "This live stream has ended.": "انتهى هذا البث المباشر.",
            "Playback failed.": "تعذّر التشغيل.", "This movie is not available.": "هذا الفيلم غير متاح."
        ] {
            XCTAssertEqual(TVStrings.text(key, bundle: arabic), expected)
        }
        XCTAssertEqual(TVStrings.playbackFailureMessage(nil, bundle: arabic), "تعذّر على AYIN بدء تشغيل هذا المحتوى.")
    }

    func testProgressAndMetadataFormatsKeepTheirArguments() throws {
        let english = try languageBundle("en")
        let arabic = try languageBundle("ar")
        for (milliseconds, time) in [(-1, "0:00"), (0, "0:00"), (65_999, "1:05"), (3_599_000, "59:59"), (3_661_000, "1:01:01")] {
            XCTAssertEqual(TVStrings.resumePosition(milliseconds, bundle: english), "\(time) watched")
            XCTAssertEqual(TVStrings.resumePosition(milliseconds, bundle: arabic), "تمت مشاهدة \(time)")
        }
        XCTAssertEqual(TVStrings.seasonTitle(nil, number: 12, bundle: english), "Season 12")
        XCTAssertEqual(TVStrings.seasonTitle(nil, number: 12, bundle: arabic), "الموسم 12")
        XCTAssertEqual(TVStrings.movieMetadata(year: 2026, rating: "PG-13", minutes: 105, bundle: english),
                       "2026 · PG-13 · 105 min")
        XCTAssertEqual(TVStrings.movieMetadata(year: 2026, rating: "PG-13", minutes: 105, bundle: arabic),
                       "2026 · PG-13 · 105 دقيقة")
    }

    func testServerOwnedStringsAreNeverLocalizedOrInterpretedAsFormats() throws {
        let arabic = try languageBundle("ar")
        for value in ["Play", "100% %@ %d", "عنوان من المصدر"] {
            XCTAssertEqual(TVStrings.seasonTitle(value, number: 1, bundle: arabic), value)
            XCTAssertEqual(TVStrings.playbackFailureMessage(value, bundle: arabic), value)
            XCTAssertEqual(TVStrings.creatorTVDescription(state: "OFF_AIR", status: value, bundle: arabic), value)
            XCTAssertEqual(TVStrings.movieMetadata(year: 2026, rating: value, minutes: 90, bundle: arabic),
                           "2026 · \(value) · 90 دقيقة")
            XCTAssertEqual(APIClientError.server(status: 403, message: value).errorDescription, value)
        }
    }

    private func languageBundle(_ language: String) throws -> Bundle {
        let url = try XCTUnwrap(Bundle.main.url(forResource: language, withExtension: "lproj"))
        return try XCTUnwrap(Bundle(url: url))
    }

    private func strings(for language: String) throws -> [String: String] {
        let bundle = try languageBundle(language)
        let url = try XCTUnwrap(bundle.url(forResource: "Localizable", withExtension: "strings"))
        let data = try Data(contentsOf: url)
        return try XCTUnwrap(PropertyListSerialization.propertyList(from: data, options: [], format: nil) as? [String: String])
    }

    private func formats(in string: String, using expression: NSRegularExpression) -> [String] {
        expression.matches(in: string, range: NSRange(string.startIndex..., in: string)).map {
            (string as NSString).substring(with: $0.range)
        }
    }

    private let requiredKeys: Set<String> = [
        "Home", "Search", "My AYIN", "Account", "Loading AYIN…", "AYIN is unavailable", "Try Again",
        "Loading…", "More", "More Results", "No results", "Search Kids on AYIN", "Movies, series, creators, videos",
        "Restoring your AYIN session…", "Sign in to continue", "Couldn’t load My AYIN", "Restoring AYIN…",
        "Sign Out", "Sign in to AYIN", "Sign In", "Retry Saved Session", "Security setup required",
        "Finish MFA enrollment on AYIN web, then return to Apple TV.", "Two-factor authentication",
        "Recovery code", "Use authenticator code", "6-digit code", "Use recovery code", "Verify", "AYIN account",
        "Email", "Password", "Cancel", "Content unavailable", "Adaptive HLS playback", "Video", "Open Creator TV",
        "Videos", "On Air", "Watch Creator TV", "Now Playing", "Up Next", "Guide", "Playlist is empty",
        "This playlist has no playable videos.", "%d · %@ · %d min", "Play Movie", "Trailer", "Season %d", "Play",
        "This movie is not available.", "%d:%02d:%02d watched", "%d:%02d watched", "Playback unavailable",
        "AYIN could not start this title.", "Playback continues. Review saved progress before saving more.",
        "Reviewing…", "Review saved progress", "Off", "Subtitles", "Chapters", "Next Episode", "Live",
        "This live stream has ended.", "Playback failed.",
        // The shared Foundation errors resolve against the tvOS app bundle too.
        "This AYIN stream is not available right now.", "AYIN returned an invalid media URL.",
        "AYIN returned an invalid response.", "AYIN could not build a secure request URL.", "AYIN request failed.",
        "AYIN is still restoring your session. Try again in a moment.",
        "Enter either an authenticator code or a recovery code.",
        "AYIN could not access your saved session securely. Try again.",
        "AYIN could not read your saved session. Sign in again."
    ]
}
