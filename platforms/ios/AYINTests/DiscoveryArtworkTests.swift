import SwiftUI
import UIKit
import XCTest
@testable import AYIN

@MainActor
final class DiscoveryArtworkTests: XCTestCase {
    func testArtworkUsesConfiguredMediaOriginAndEncodesObjectKey() throws {
        let artwork = DiscoveryArtwork(artworkObjectKey: "artwork/a cover.jpg", type: "VIDEO")
        let url = try XCTUnwrap(artwork.artworkURL)

        XCTAssertEqual(url.scheme, "https")
        XCTAssertEqual(url.host, AppEnvironment.mediaBaseURL.host)
        XCTAssertEqual(url.path, "/artwork/a cover.jpg")
        XCTAssertTrue(url.absoluteString.contains("a%20cover.jpg"))
    }

    func testMissingAndEmptyArtworkDoNotRequestAnImage() {
        for objectKey in [nil, ""] as [String?] {
            XCTAssertNil(DiscoveryArtwork(artworkObjectKey: objectKey, type: "VIDEO").artworkURL)
        }
    }

    func testLoadingAndFailedArtworkRenderTheSameFixedSizePlaceholder() throws {
        for type in ["VIDEO", "CHANNEL"] {
            let loading = try render(.empty, type: type)
            let failed = try render(.failure(URLError(.notConnectedToInternet)), type: type)

            XCTAssertEqual(loading.size, CGSize(width: 210, height: 118))
            XCTAssertEqual(failed.size, loading.size)
            XCTAssertEqual(try XCTUnwrap(loading.pngData()), try XCTUnwrap(failed.pngData()))
        }
    }

    func testLoadedArtworkKeepsTheCardSizeForWideAndTallImages() throws {
        for size in [CGSize(width: 800, height: 100), CGSize(width: 100, height: 800)] {
            let image = UIGraphicsImageRenderer(size: size).image { context in
                UIColor.red.setFill()
                context.fill(CGRect(origin: .zero, size: size))
            }
            let loaded = try render(.success(Image(uiImage: image)), type: "VIDEO")
            let placeholder = try render(.empty, type: "VIDEO")

            XCTAssertEqual(loaded.size, CGSize(width: 210, height: 118))
            XCTAssertNotEqual(try XCTUnwrap(loaded.pngData()), try XCTUnwrap(placeholder.pngData()))
        }
    }

    private func render(_ phase: AsyncImagePhase, type: String) throws -> UIImage {
        let renderer = ImageRenderer(content: DiscoveryArtwork.Content(phase: phase, type: type))
        renderer.scale = 1
        return try XCTUnwrap(renderer.uiImage)
    }
}
