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
