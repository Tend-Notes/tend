// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation

/// The fundamental outliner unit — one bullet point.
///
/// Mirrors the backend `Block` (`crates/tend-core/src/block.rs`), which serializes
/// **camelCase**. This type is for **decoding responses**; to *write* blocks back to
/// the server use ``BlockPayload`` (snake_case `parent_uuid`) — the request and
/// response shapes differ and must not be merged.
///
/// `uuid`/`parentUuid`/`children` are kept as `String` (not `UUID`) to preserve the
/// server's exact lowercase-hyphenated form, which also appears inline in block
/// content as `((uuid))` block references.
public struct Block: Codable, Equatable, Identifiable, Sendable {
    public var uuid: String
    public var content: String
    public var parentUuid: String?
    public var children: [String]
    public var collapsed: Bool
    public var properties: [String: String]
    public var depth: Int

    public var id: String { uuid }

    public init(
        uuid: String,
        content: String,
        parentUuid: String? = nil,
        children: [String] = [],
        collapsed: Bool = false,
        properties: [String: String] = [:],
        depth: Int = 0
    ) {
        self.uuid = uuid
        self.content = content
        self.parentUuid = parentUuid
        self.children = children
        self.collapsed = collapsed
        self.properties = properties
        self.depth = depth
    }
}

public extension Block {
    /// Whether this block has no non-whitespace content.
    var isEmpty: Bool { content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// The request payload form of this block (snake_case `parent_uuid`).
    var payload: BlockPayload {
        BlockPayload(
            uuid: uuid,
            content: content,
            parentUuid: parentUuid,
            children: children,
            collapsed: collapsed,
            properties: properties
        )
    }
}
