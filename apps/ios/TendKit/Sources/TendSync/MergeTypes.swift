// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation
import TendModel

/// Why a block could not be auto-merged.
public enum ConflictKind: Equatable, Sendable {
    /// The same block was edited differently on both sides.
    case contentDivergence
    /// One side deleted a block the other side edited.
    case deleteModify
    /// The same new block UUID was added on both sides with different content.
    case addAdd
    /// Tree order (a block's children, or the page roots) changed differently on both
    /// sides. `uuid` is empty for the page-root ordering.
    case structural
}

/// A single unresolved conflict, carrying all three versions so the UI can offer a
/// meaningful choice.
public struct BlockConflict: Equatable, Sendable {
    public var uuid: String
    public var kind: ConflictKind
    public var base: Block?
    public var mine: Block?
    public var theirs: Block?

    public init(uuid: String, kind: ConflictKind, base: Block?, mine: Block?, theirs: Block?) {
        self.uuid = uuid
        self.kind = kind
        self.base = base
        self.mine = mine
        self.theirs = theirs
    }
}

/// The outcome of a three-way merge: a best-effort merged page plus any conflicts. When
/// `conflicts` is empty the merge is clean and `page` can be saved directly (carrying the
/// server's current version). Otherwise the app resolves the conflicts — per-block, or via
/// a page-level Keep Mine / Keep Server fallback.
public struct MergeResult: Equatable, Sendable {
    public var page: Page
    public var conflicts: [BlockConflict]

    public var isClean: Bool { conflicts.isEmpty }

    public init(page: Page, conflicts: [BlockConflict]) {
        self.page = page
        self.conflicts = conflicts
    }
}

extension Block {
    /// Equality over the user-meaningful fields, ignoring server-derived `depth` (which can
    /// be stale locally and would otherwise register as a spurious change).
    func semanticallyEquals(_ other: Block) -> Bool {
        content == other.content
            && parentUuid == other.parentUuid
            && children == other.children
            && collapsed == other.collapsed
            && properties == other.properties
    }
}
