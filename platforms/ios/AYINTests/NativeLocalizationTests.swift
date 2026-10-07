import XCTest
@testable import AYIN

final class NativeLocalizationTests: XCTestCase {
    func testPackagedEnglishAndArabicResourcesCoverTheNativeShell() throws {
        let english = try strings(for: "en")
        let arabic = try strings(for: "ar")
        XCTAssertEqual(Set(english.keys), Set(arabic.keys))
        XCTAssertTrue(requiredShellKeys.isSubset(of: Set(english.keys)))

        for key in requiredShellKeys {
            XCTAssertEqual(english[key], key, "English fallback changed for \(key)")
            let translation = try XCTUnwrap(arabic[key], key)
            XCTAssertFalse(translation.isEmpty, key)
            XCTAssertNotEqual(translation, key, "Arabic translation missing for \(key)")
            XCTAssertEqual(translation.components(separatedBy: "%@").count,
                           key.components(separatedBy: "%@").count,
                           "Format arguments differ for \(key)")
        }
    }

    func testSystemLanguageSelectionSupportsRegionalArabicAndEnglish() {
        let localizations = Bundle.main.localizations
        XCTAssertTrue(localizations.contains("ar"))
        XCTAssertTrue(localizations.contains("en"))
        XCTAssertEqual(Bundle.main.developmentLocalization, "en")
        for language in ["ar", "ar-EG", "ar-SA"] {
            XCTAssertEqual(Bundle.preferredLocalizations(from: localizations, forPreferences: [language]).first, "ar")
        }
        XCTAssertEqual(Bundle.preferredLocalizations(from: localizations, forPreferences: ["en-GB"]).first, "en")
        XCTAssertEqual(Bundle.preferredLocalizations(from: localizations, forPreferences: ["fr-FR", "en-US"]).first, "en")
        XCTAssertEqual(Locale.Language(identifier: "ar").characterDirection, .rightToLeft)
    }

    func testDynamicArabicActionsLocalizeBothBranches() throws {
        let bundle = try languageBundle("ar")
        XCTAssertEqual(NativeStrings.discoverySearchTitle(isKids: false, bundle: bundle), "ابحث على الويب")
        XCTAssertEqual(NativeStrings.discoverySearchTitle(isKids: true, bundle: bundle), "تصفّح قسم الأطفال على الويب")
        XCTAssertEqual(NativeStrings.discoveryBrowseTitle(isKids: false, bundle: bundle), "تصفّح المزيد على الويب")
        XCTAssertEqual(NativeStrings.discoveryBrowseTitle(isKids: true, bundle: bundle), "تصفّح قسم الأطفال على الويب")
        XCTAssertEqual(NativeStrings.webSessionNotice(canOpen: true, bundle: bundle),
                       "تسجيل الدخول على الويب منفصل عن هذا التطبيق. قد تختلف قوائم المحتوى المتاحة.")
        XCTAssertEqual(NativeStrings.webSessionNotice(canOpen: false, bundle: bundle),
                       "سجّل الدخول أو أعد محاولة استعادة جلستك المحفوظة قبل التصفّح على الويب.")
        XCTAssertEqual(NativeStrings.discoveryBrowseHint(isKids: true, bundle: bundle),
                       "يفتح قسم الأطفال على الويب، حيث يمكنك تحميل المزيد في قوائم المحتوى المتاحة.")
        XCTAssertEqual(NativeStrings.discoveryBrowseHint(isKids: false, bundle: bundle),
                       "يفتح الصفحة الرئيسية على الويب، حيث يمكنك تحميل المزيد في قوائم المحتوى المتاحة.")
        XCTAssertEqual(NativeStrings.progressReviewTitle(isReviewing: true, bundle: bundle), "جارٍ المراجعة…")
        XCTAssertEqual(NativeStrings.progressReviewTitle(isReviewing: false, bundle: bundle), "مراجعة تقدّم المشاهدة المحفوظ")
        XCTAssertEqual(NativeStrings.openOnWebTitle(isOpening: true, bundle: bundle), "جارٍ الفتح…")
        XCTAssertEqual(NativeStrings.openOnWebTitle(isOpening: false, bundle: bundle), "فتح على الويب")
    }

    func testDynamicEnglishLabelsAndServerTitlesRemainIntact() throws {
        let english = try languageBundle("en")
        let arabic = try languageBundle("ar")
        XCTAssertEqual(NativeStrings.discoverySearchTitle(isKids: false, bundle: english), "Search on web")
        XCTAssertEqual(NativeStrings.discoveryBrowseTitle(isKids: true, bundle: english), "Browse Kids on web")
        XCTAssertEqual(NativeStrings.progressReviewTitle(isReviewing: true, bundle: english), "Reviewing…")

        // A title is substituted once and is never itself used as a localization key or format.
        let title = "Sign in 100% %@"
        XCTAssertEqual(NativeStrings.browseMoreAccessibilityLabel(rowTitle: title, bundle: english),
                       "Browse more from \(title) on the web")
        XCTAssertEqual(NativeStrings.browseMoreAccessibilityLabel(rowTitle: title, bundle: arabic),
                       "تصفّح المزيد من \(title) على الويب")
        XCTAssertEqual(NativeStrings.playbackFailureMessage(nil, bundle: arabic), "تعذّر على AYIN بدء تشغيل هذا الفيديو.")
        XCTAssertEqual(NativeStrings.playbackFailureMessage("Sign in", bundle: arabic), "Sign in")
        XCTAssertEqual(APIClientError.server(status: 403, message: "Sign in").errorDescription, "Sign in")
    }

    func testAppGeneratedErrorsUseTheAppLocalization() {
        let errors: [(any LocalizedError, String)] = [
            (APIClientError.invalidResponse, "AYIN returned an invalid response."),
            (APIClientError.invalidURL, "AYIN could not build a secure request URL."),
            (PlaybackError.unavailable, "This AYIN stream is not available right now."),
            (PlaybackError.invalidMediaURL, "AYIN returned an invalid media URL."),
            (SessionControllerError.restorationInProgress, "AYIN is still restoring your session. Try again in a moment."),
            (SessionControllerError.invalidMFAInput, "Enter either an authenticator code or a recovery code."),
            (KeychainStoreError.unexpectedStatus(-1), "AYIN could not access your saved session securely. Try again."),
            (KeychainStoreError.invalidData, "AYIN could not read your saved session. Sign in again.")
        ]
        for (error, key) in errors {
            XCTAssertEqual(error.errorDescription, Bundle.main.localizedString(forKey: key, value: nil, table: nil))
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

    private let requiredShellKeys: Set<String> = [
        "Restoring session…", "Loading AYIN…", "AYIN is unavailable", "No content to show yet",
        "Try loading Home again or browse AYIN on the web.", "Browse Kids on web", "Search on web",
        "Opens in Safari. Web sign-in is separate from this app.", "Sign out", "Restoring session",
        "Sign in", "Retry saved session", "Try again", "Browse more on web",
        "Web sign-in is separate from this app. Available rows may differ.",
        "Sign in or retry your saved session before opening Web discovery.",
        "Browse more from %@ on the web",
        "Opens the Web Kids catalog, where available rows have Load more controls.",
        "Opens Web Home, where available rows have Load more controls.",
        "This account must finish MFA enrollment on AYIN web before native iOS sign-in can continue.",
        "Security setup required", "Two-factor authentication", "Recovery code", "Use authenticator code",
        "6-digit code", "Use recovery code", "Verify", "AYIN account", "Email", "Password", "Cancel",
        "Loading video…", "Playback unavailable", "AYIN could not start this video.", "Close player", "Share",
        "Playback continues. Review saved progress before saving more.", "Reviewing…", "Review saved progress",
        "Opening…", "Open on web", "Continue with available captions, chapters and next episodes.",
        "Playback failed.", "This AYIN stream is not available right now.", "AYIN returned an invalid media URL.",
        "AYIN returned an invalid response.", "AYIN could not build a secure request URL.", "AYIN request failed.",
        "AYIN is still restoring your session. Try again in a moment.",
        "Enter either an authenticator code or a recovery code.",
        "AYIN could not access your saved session securely. Try again.",
        "AYIN could not read your saved session. Sign in again."
    ]
}
