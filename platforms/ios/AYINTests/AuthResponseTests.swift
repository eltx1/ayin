import XCTest
@testable import AYIN

final class AuthResponseTests: XCTestCase {
    func testBearerLoginResponseDecodes() throws {
        let data = Data("""
        {
          "sessionToken": "token-value",
          "user": {
            "account": {"displayName":"Viewer","email":"viewer@example.com","id":"account"},
            "channel": {"handle":"viewer","id":"channel","name":"Viewer"},
            "creatorTv": {"id":"tv","name":"Viewer TV","slug":"viewer-tv"},
            "profile": {"id":"profile","name":"Viewer","slug":"viewer"}
          }
        }
        """.utf8)

        let response = try JSONDecoder().decode(AuthResponse.self, from: data)
        XCTAssertEqual(response.sessionToken, "token-value")
        XCTAssertEqual(response.user?.account.displayName, "Viewer")
    }

    func testProfileKidsStateDecodesAndOldPayloadDefaultsToAdult() throws {
        let kids = Data("""
        {
          "sessionToken": "token-value",
          "user": {
            "account": {"displayName":"Kid","email":"kid@example.com","id":"account"},
            "channel": {"handle":"kid","id":"channel","name":"Kid"},
            "creatorTv": {"id":"tv","name":"Kid TV","slug":"kid-tv"},
            "profile": {"id":"profile","name":"Kid","slug":"kid","isKids":true}
          }
        }
        """.utf8)

        let kidsResponse = try JSONDecoder().decode(AuthResponse.self, from: kids)
        XCTAssertEqual(kidsResponse.user?.profile.isKids, true)

        let legacy = Data("""
        {
          "sessionToken": "token-value",
          "user": {
            "account": {"displayName":"Viewer","email":"viewer@example.com","id":"account"},
            "channel": {"handle":"viewer","id":"channel","name":"Viewer"},
            "creatorTv": {"id":"tv","name":"Viewer TV","slug":"viewer-tv"},
            "profile": {"id":"profile","name":"Viewer","slug":"viewer"}
          }
        }
        """.utf8)

        let legacyResponse = try JSONDecoder().decode(AuthResponse.self, from: legacy)
        XCTAssertEqual(legacyResponse.user?.profile.isKids, false)
    }

    func testMFAChallengeResponseDecodes() throws {
        let data = Data("""
        {"mfaRequired":true,"enrollmentRequired":false,"challengeToken":"challenge"}
        """.utf8)

        let response = try JSONDecoder().decode(AuthResponse.self, from: data)
        XCTAssertEqual(response.mfaRequired, true)
        XCTAssertEqual(response.enrollmentRequired, false)
        XCTAssertEqual(response.challengeToken, "challenge")
    }
}
