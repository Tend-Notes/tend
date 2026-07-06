// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation

/// A block in the shape the backend expects for **write** requests
/// (`PUT /pages/{name}`, `/journals/{date}`, `/sheets/{type}/{name}`, templates).
///
/// Note the snake_case `parent_uuid` — this differs from the camelCase ``Block``
/// response type. There is no `depth` in the request; the server derives it.
public struct BlockPayload: Codable, Equatable, Sendable {
    public var uuid: String
    public var content: String
    public var parentUuid: String?
    public var children: [String]
    public var collapsed: Bool
    public var properties: [String: String]

    public init(
        uuid: String,
        content: String,
        parentUuid: String? = nil,
        children: [String] = [],
        collapsed: Bool = false,
        properties: [String: String] = [:]
    ) {
        self.uuid = uuid
        self.content = content
        self.parentUuid = parentUuid
        self.children = children
        self.collapsed = collapsed
        self.properties = properties
    }

    enum CodingKeys: String, CodingKey {
        case uuid
        case content
        case parentUuid = "parent_uuid"
        case children
        case collapsed
        case properties
    }
}

/// Body for a full-page replace write. `version` carries optimistic-concurrency intent:
/// pass the version you loaded; the server returns `409 VERSION_CONFLICT` if it moved on.
/// Omit (`nil`) only for first-write / force scenarios.
public struct UpdatePageRequest: Codable, Equatable, Sendable {
    public var blocks: [BlockPayload]
    public var version: Int?

    public init(blocks: [BlockPayload], version: Int?) {
        self.blocks = blocks
        self.version = version
    }
}

/// Body for `POST /pages`. `content` seeds the first block, if provided.
public struct CreatePageRequest: Codable, Equatable, Sendable {
    public var name: String
    public var content: String?

    public init(name: String, content: String? = nil) {
        self.name = name
        self.content = content
    }
}

/// Body for `POST /sheets/{type}`. `date` applies to date-organized content types.
public struct CreateSheetRequest: Codable, Equatable, Sendable {
    public var name: String
    public var date: String?
    public var content: String?

    public init(name: String, date: String? = nil, content: String? = nil) {
        self.name = name
        self.date = date
        self.content = content
    }
}
