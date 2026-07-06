// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation
import TendModel

/// Three-way merge of a page after a `409 VERSION_CONFLICT`: reconcile the local edits
/// (`mine`) with the current server state (`theirs`) relative to the last-synced snapshot
/// (`base`).
///
/// The merge is per-block by UUID for content/properties/collapsed, and per-array
/// (page roots and each block's `children`) for order. Anything that changed on only one
/// side is taken from that side; identical changes coalesce; genuine divergence becomes a
/// ``BlockConflict`` for the app to resolve. The returned page inherits `theirs`'
/// metadata and version so a clean merge can be re-`PUT` immediately.
public enum ThreeWayMerge {
    public static func merge(base: Page, mine: Page, theirs: Page) -> MergeResult {
        var mergedBlocks: [String: Block] = [:]
        var conflicts: [BlockConflict] = []

        let allUUIDs = Set(base.blocks.keys)
            .union(mine.blocks.keys)
            .union(theirs.blocks.keys)

        for uuid in allUUIDs {
            let b = base.blocks[uuid]
            let m = mine.blocks[uuid]
            let t = theirs.blocks[uuid]

            switch (b, m, t) {
            case let (b?, m?, t?):
                // Present everywhere: merge fields.
                let mineChanged = !b.semanticallyEquals(m)
                let theirsChanged = !b.semanticallyEquals(t)
                if !mineChanged {
                    mergedBlocks[uuid] = t
                } else if !theirsChanged {
                    mergedBlocks[uuid] = m
                } else if m.semanticallyEquals(t) {
                    mergedBlocks[uuid] = m
                } else {
                    // Both edited differently. Field-merge what we safely can (children
                    // order via three-way), flag the rest as a content conflict.
                    mergedBlocks[uuid] = mergedBlock(base: b, mine: m, theirs: t, conflicts: &conflicts)
                }

            case let (nil, m?, t?):
                // Added on both sides with the same UUID.
                if m.semanticallyEquals(t) {
                    mergedBlocks[uuid] = m
                } else {
                    conflicts.append(BlockConflict(uuid: uuid, kind: .addAdd, base: nil, mine: m, theirs: t))
                    mergedBlocks[uuid] = m
                }

            case let (nil, m?, nil):
                mergedBlocks[uuid] = m           // added locally

            case let (nil, nil, t?):
                mergedBlocks[uuid] = t           // added remotely

            case let (b?, m?, nil):
                // Deleted remotely. Keep only if we didn't touch it.
                if b.semanticallyEquals(m) {
                    // clean remote delete — omit
                } else {
                    conflicts.append(BlockConflict(uuid: uuid, kind: .deleteModify, base: b, mine: m, theirs: nil))
                    mergedBlocks[uuid] = m
                }

            case let (b?, nil, t?):
                // Deleted locally. Honor the delete only if the server didn't change it.
                if b.semanticallyEquals(t) {
                    // clean local delete — omit
                } else {
                    conflicts.append(BlockConflict(uuid: uuid, kind: .deleteModify, base: b, mine: nil, theirs: t))
                    mergedBlocks[uuid] = t
                }

            case (_?, nil, nil):
                break // deleted on both sides — omit

            case (nil, nil, nil):
                break // unreachable (uuid came from one of the maps)
            }
        }

        // Merge the page-root ordering.
        let rootMerge = mergeOrder(base.rootBlocks, mine.rootBlocks, theirs.rootBlocks)
        var rootBlocks: [String]
        switch rootMerge {
        case .resolved(let order):
            rootBlocks = order
        case .conflict:
            conflicts.append(BlockConflict(uuid: "", kind: .structural, base: nil, mine: nil, theirs: nil))
            rootBlocks = mine.rootBlocks // tentative
        }

        // Prune any references to blocks that no longer exist post-merge, keeping the tree
        // internally consistent.
        rootBlocks = rootBlocks.filter { mergedBlocks[$0] != nil }
        for uuid in mergedBlocks.keys {
            mergedBlocks[uuid]?.children.removeAll { mergedBlocks[$0] == nil }
        }

        // Build the merged page from `theirs` (server metadata + current version).
        var page = theirs
        page.blocks = mergedBlocks
        page.rootBlocks = rootBlocks

        return MergeResult(page: page, conflicts: conflicts)
    }

    /// Merge a block whose content diverged: take `mine`'s content/properties as tentative,
    /// three-way its `children` order, and record a content conflict.
    private static func mergedBlock(
        base: Block, mine: Block, theirs: Block, conflicts: inout [BlockConflict]
    ) -> Block {
        var result = mine
        switch mergeOrder(base.children, mine.children, theirs.children) {
        case .resolved(let order):
            result.children = order
        case .conflict:
            conflicts.append(BlockConflict(uuid: mine.uuid, kind: .structural, base: base, mine: mine, theirs: theirs))
        }
        conflicts.append(BlockConflict(uuid: mine.uuid, kind: .contentDivergence, base: base, mine: mine, theirs: theirs))
        return result
    }

    private enum OrderMerge: Equatable {
        case resolved([String])
        case conflict
    }

    /// Classic three-way merge of an ordered list treated as a whole value.
    private static func mergeOrder(_ base: [String], _ mine: [String], _ theirs: [String]) -> OrderMerge {
        if mine == base { return .resolved(theirs) }
        if theirs == base { return .resolved(mine) }
        if mine == theirs { return .resolved(mine) }
        return .conflict
    }
}
