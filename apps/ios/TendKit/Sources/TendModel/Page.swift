// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation

/// A page — a Markdown file's worth of blocks in a tree. Pages, journals, and custom
/// "sheets" all share this one shape (`crates/tend-core/src/page.rs`), distinguished by
/// `contentType` / `isJournal` / `journalDate`.
///
/// Timestamps and `journalDate` are kept as their raw string forms (`createdAt`/
/// `modifiedAt` are RFC3339; `journalDate` is `YYYY-MM-DD`) for exact round-trip
/// fidelity; typed accessors live in ``Page`` extensions.
public struct Page: Codable, Equatable, Sendable {
    public var name: String
    public var title: String
    public var rootBlocks: [String]
    public var blocks: [String: Block]
    public var properties: [String: String]
    public var contentType: String
    public var isJournal: Bool
    public var journalDate: String?
    public var createdAt: String
    public var modifiedAt: String
    /// Optimistic-concurrency version; increments on each server save. Echo it back on
    /// writes so the server can reject stale updates with `409 VERSION_CONFLICT`.
    public var version: Int

    public init(
        name: String,
        title: String,
        rootBlocks: [String] = [],
        blocks: [String: Block] = [:],
        properties: [String: String] = [:],
        contentType: String = "page",
        isJournal: Bool = false,
        journalDate: String? = nil,
        createdAt: String,
        modifiedAt: String,
        version: Int = 1
    ) {
        self.name = name
        self.title = title
        self.rootBlocks = rootBlocks
        self.blocks = blocks
        self.properties = properties
        self.contentType = contentType
        self.isJournal = isJournal
        self.journalDate = journalDate
        self.createdAt = createdAt
        self.modifiedAt = modifiedAt
        self.version = version
    }
}

public extension Page {
    /// All blocks in depth-first tree order, following `rootBlocks` then each block's
    /// `children`. Skips any dangling child UUIDs not present in `blocks`.
    var blocksInOrder: [Block] {
        var result: [Block] = []
        result.reserveCapacity(blocks.count)
        var visited = Set<String>()
        func walk(_ uuid: String) {
            guard visited.insert(uuid).inserted, let block = blocks[uuid] else { return }
            result.append(block)
            for child in block.children { walk(child) }
        }
        for root in rootBlocks { walk(root) }
        return result
    }

    /// The write payload for this page's blocks, in the API's request shape.
    var blockPayloads: [BlockPayload] { blocks.values.map(\.payload) }
}

/// Lightweight page listing entry (no block contents) — `GET /pages`, `/journals`,
/// `/sheets/{type}`. Mirrors backend `PageMeta` (camelCase).
public struct PageMeta: Codable, Equatable, Identifiable, Sendable {
    public var name: String
    public var title: String
    public var contentType: String
    public var isJournal: Bool
    public var journalDate: String?
    public var blockCount: Int
    public var createdAt: String
    public var modifiedAt: String

    public var id: String { "\(contentType)/\(name)" }

    public init(
        name: String,
        title: String,
        contentType: String = "page",
        isJournal: Bool = false,
        journalDate: String? = nil,
        blockCount: Int,
        createdAt: String,
        modifiedAt: String
    ) {
        self.name = name
        self.title = title
        self.contentType = contentType
        self.isJournal = isJournal
        self.journalDate = journalDate
        self.blockCount = blockCount
        self.createdAt = createdAt
        self.modifiedAt = modifiedAt
    }
}
