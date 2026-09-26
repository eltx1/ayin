import Foundation

struct AYINIdentity: Codable, Equatable {
    struct Account: Codable, Equatable {
        let displayName: String
        let email: String
        let id: String
    }

    struct Channel: Codable, Equatable {
        let handle: String
        let id: String
        let name: String
    }

    struct CreatorTV: Codable, Equatable {
        let id: String
        let name: String
        let slug: String
    }

    struct Profile: Codable, Equatable {
        let id: String
        let name: String
        let slug: String
        let isKids: Bool

        init(id: String, name: String, slug: String, isKids: Bool = false) {
            self.id = id
            self.name = name
            self.slug = slug
            self.isKids = isKids
        }

        enum CodingKeys: String, CodingKey {
            case id, name, slug, isKids
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            id = try container.decode(String.self, forKey: .id)
            name = try container.decode(String.self, forKey: .name)
            slug = try container.decode(String.self, forKey: .slug)
            isKids = try container.decodeIfPresent(Bool.self, forKey: .isKids) ?? false
        }
    }

    let account: Account
    let channel: Channel
    let creatorTv: CreatorTV
    let profile: Profile
}

struct LoginRequest: Encodable {
    let email: String
    let password: String
}

struct MFARequest: Encodable {
    let challengeToken: String
    let code: String?
    let recoveryCode: String?
}

struct AuthResponse: Decodable {
    let sessionToken: String?
    let user: AYINIdentity?
    let mfaRequired: Bool?
    let enrollmentRequired: Bool?
    let challengeToken: String?
}

struct MFAChallenge: Equatable {
    let token: String
    let enrollmentRequired: Bool
}
