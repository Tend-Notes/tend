// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation

/// Task-status keyword that may prefix a block's content (e.g. `TODO Buy milk`).
///
/// The set of keywords the backend recognizes (`crates/tend-core/src/block.rs`):
/// TODO, DOING, DONE, LATER, NOW, WAITING, CANCELLED. The web app also exposes a
/// configurable *display* set (`TODO/DOING/DONE` vs `NOW/LATER/NEVER`); that is a UI
/// concern layered on top of these raw keywords.
public enum TaskStatus: String, CaseIterable, Codable, Sendable {
    case todo = "TODO"
    case doing = "DOING"
    case done = "DONE"
    case later = "LATER"
    case now = "NOW"
    case waiting = "WAITING"
    case cancelled = "CANCELLED"

    /// The keyword followed by a space, as it appears at the start of block content.
    public var prefix: String { rawValue + " " }

    /// Detect a leading task keyword on a block's content, returning the status and the
    /// remaining text after the keyword. Leading whitespace is ignored (matching the
    /// backend's `content.trim_start()`).
    public static func parse(_ content: String) -> (status: TaskStatus, rest: String)? {
        let trimmed = content.drop { $0 == " " || $0 == "\t" }
        for status in allCases where trimmed.hasPrefix(status.prefix) {
            return (status, String(trimmed.dropFirst(status.prefix.count)))
        }
        return nil
    }

    /// Whether this status represents an open task (not done/cancelled).
    public var isOpen: Bool {
        switch self {
        case .todo, .doing, .later, .now, .waiting: return true
        case .done, .cancelled: return false
        }
    }
}
