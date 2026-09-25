import XCTest
@testable import AYINTV

final class TVWebVTTTests: XCTestCase {
    func testParsesExternalWebVTTCues() {
        let source = """
        WEBVTT

        00:00:01.000 --> 00:00:03.500
        Hello <b>Apple TV</b>

        00:04.20 --> 00:06.00
        Second cue
        """

        let cues = TVWebVTT.parse(source)
        XCTAssertEqual(cues.count, 2)
        XCTAssertEqual(cues[0], TVCaptionCue(startMs: 1_000, endMs: 3_500, text: "Hello Apple TV"))
        XCTAssertTrue(cues[1].contains(5_000))
        XCTAssertFalse(cues[1].contains(6_000))
    }

    func testRejectsMalformedCue() {
        XCTAssertTrue(TVWebVTT.parse("WEBVTT\n\nnot a cue").isEmpty)
    }
}
